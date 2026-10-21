import fs from "fs";
import path from "path";
import dcmjs from "../../src/index.js";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { fromPart10 } from "../../src/eventStream/fromPart10";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { addAccessors } from "@dcmjs-org/core";

const { DicomMessage } = dcmjs.data;

/** Drive helpers. */
const scalar = (l, tag, vr, ...values) => {
    l.startElement(tag, { vr });
    for (const v of values) l.value(v);
    l.endElement();
};

describe("NaturalizedListener — keyword naming + scalar cardinality", () => {
    test("maps tags to canonical keywords; VM-1 single value is a scalar", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        scalar(l, "00100020", "LO", "12345"); // PatientID, VM 1
        scalar(l, "00200013", "IS", 12); // InstanceNumber, VM 1
        l.endDataSet();
        expect(l.result).toEqual({
            _vrMap: {},
            PatientID: "12345",
            InstanceNumber: 12
        });
    });

    test("VM-1 present-empty is null; absent is omitted", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        scalar(l, "00100020", "LO"); // present, no value
        l.endDataSet();
        expect(l.result).toEqual({ _vrMap: {}, PatientID: null });
        expect("InstanceNumber" in l.result).toBe(false);
    });

    test("VM-1 with multiple values: warnAndPreserve keeps an array and records a violation", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        scalar(l, "00100020", "LO", "12345", "67890");
        l.endDataSet();
        expect(l.result.PatientID).toEqual(["12345", "67890"]);
        expect(l.violations.some(v => v.keyword === "PatientID")).toBe(true);
    });
});

describe("NaturalizedListener — multi-VM cardinality", () => {
    test("VM 1-n / 2-n stays list-like even for a single value", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        scalar(l, "00080008", "CS", "ORIGINAL"); // ImageType, VM 2-n
        scalar(l, "00101000", "LO", "A"); // OtherPatientIDs, VM 1-n
        l.endDataSet();
        expect(l.result.ImageType).toEqual(["ORIGINAL"]);
        expect(l.result.OtherPatientIDs).toEqual(["A"]);
    });

    test("multi-VM present-empty is an empty array", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        scalar(l, "00080008", "CS"); // present, no value
        l.endDataSet();
        expect(l.result.ImageType).toEqual([]);
    });

    test("multi-VM multiple values is the array", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        scalar(l, "00080008", "CS", "ORIGINAL", "PRIMARY", "AXIAL");
        l.endDataSet();
        expect(l.result.ImageType).toEqual(["ORIGINAL", "PRIMARY", "AXIAL"]);
    });
});

describe("NaturalizedListener — sequences", () => {
    function item(l, build) {
        l.startItem({});
        build();
        l.endItem();
    }

    test("single-item sequence is the item object, with hidden length 1", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startSequence("00081110", { vr: "SQ" }); // ReferencedStudySequence, VM 1
        item(l, () => scalar(l, "00081150", "UI", "1.2.3"));
        l.endSequence();
        l.endDataSet();

        const seq = l.result.ReferencedStudySequence;
        expect(seq.ReferencedSOPClassUID).toBe("1.2.3"); // delegates to item[0]
        expect(seq.length).toBe(1);
        expect(seq[0].ReferencedSOPClassUID).toBe("1.2.3");
    });

    test("multi-item sequence is an array (not a violation, even at declared VM 1)", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startSequence("52009230", { vr: "SQ" }); // PerFrameFunctionalGroupsSequence
        item(l, () => scalar(l, "00200013", "IS", 1));
        item(l, () => scalar(l, "00200013", "IS", 2));
        l.endSequence();
        l.endDataSet();

        expect(Array.isArray(l.result.PerFrameFunctionalGroupsSequence)).toBe(
            true
        );
        expect(l.result.PerFrameFunctionalGroupsSequence).toHaveLength(2);
        expect(l.violations).toEqual([]);
    });

    test("present-empty sequence is an empty array", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startSequence("00081110", { vr: "SQ" });
        l.endSequence();
        l.endDataSet();
        expect(l.result.ReferencedStudySequence).toEqual([]);
    });
});

describe("NaturalizedListener — binary and meta", () => {
    test("assembled binary fragments become a list of ArrayBuffer", () => {
        const l = new NaturalizedListener();
        const buf = new Uint8Array([1, 2, 3, 4]).buffer;
        l.startDataSet({});
        l.startElement("7FE00010", { vr: "OB" });
        l.startBinary({ encapsulated: false });
        l.binaryFragment(buf);
        l.endBinary();
        l.endElement();
        l.endDataSet();
        expect(l.result.PixelData).toHaveLength(1);
        expect(l.result.PixelData[0]).toBe(buf);
    });

    test("bulkDataReference becomes BulkDataURI", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startElement("7FE00010", { vr: "OB" });
        l.bulkDataReference({ uri: "../bulk/1" });
        l.endElement();
        l.endDataSet();
        expect(l.result.PixelData).toEqual({ BulkDataURI: "../bulk/1" });
    });

    test("File Meta Information naturalizes into .meta", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startFileMetaInformation();
        scalar(l, "00020010", "UI", "1.2.840.10008.1.2.1"); // TransferSyntaxUID
        l.endFileMetaInformation();
        l.endDataSet();
        expect(l.meta.TransferSyntaxUID).toBe("1.2.840.10008.1.2.1");
    });
});

// --- generator-agnostic cross-source gate -----------------------------------

const REPO_ROOT = path.join(__dirname, "..", "..");
const PARSER_IMAGES_DIR = path.join(
    REPO_ROOT,
    "packages",
    "fixtures",
    "testImages"
);
const TEST_DIR = path.join(REPO_ROOT, "test");

function discover(dir, accept) {
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) out.push(...discover(full, accept));
        else if (stat.isFile() && accept(name)) out.push(full);
    }
    return out;
}

const FIXTURES = [
    ...discover(PARSER_IMAGES_DIR, n => !n.toLowerCase().endsWith(".md")),
    ...discover(TEST_DIR, n => /\.(dcm|dicom|lei)$/i.test(n))
].map(full => [path.relative(REPO_ROOT, full), full]);

function readBuffer(full) {
    const data = fs.readFileSync(full);
    return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
    );
}

/**
 * Normalize a naturalized object for cross-source comparison: binary leaves
 * collapse to a placeholder (raw-fragments vs frame grouping is slice G), and
 * single-item sequence proxies (arrays under the hood) compare structurally.
 */
function normalize(v) {
    if (v === null || typeof v !== "object") return v;
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return "__bytes";
    if ("InlineBinary" in v || "BulkDataURI" in v) return "__binary";
    if (Array.isArray(v)) return v.map(normalize);
    const out = {};
    for (const k of Object.keys(v).sort()) {
        // readFile rewrites SpecificCharacterSet to ISO_IR 192 at every level;
        // the raw-bytes path keeps the true source value. Exempt it everywhere.
        if (k === "SpecificCharacterSet") continue;
        out[k] = normalize(v[k]);
    }
    // keep the single-item sequence shape (hidden [0] and length)
    return v[0] === v ? addAccessors(out) : out;
}

async function naturalizeFrom(generator) {
    const l = new NaturalizedListener();
    await generator(l);
    return normalize(l.result);
}

describe("NaturalizedListener — generator-agnostic over the corpus", () => {
    test.each(FIXTURES)(
        "%s naturalizes identically from bytes and from dict",
        async (_rel, full) => {
            let dict;
            try {
                dict = DicomMessage.readFile(readBuffer(full));
            } catch {
                return; // fixtures both cores reject
            }
            const fromBytes = await naturalizeFrom(l =>
                fromPart10(readBuffer(full), l)
            );
            const fromDict = await naturalizeFrom(l =>
                fromDataSet({ meta: dict.meta, dict: dict.dict }, l)
            );
            expect(fromBytes).toEqual(fromDict);
        }
    );
});

describe("NaturalizedListener — all three sources agree (§4.4)", () => {
    test("dict and DICOMweb JSON naturalize to the same object", async () => {
        const dictSource = {
            dict: {
                "00100020": { vr: "LO", Value: ["12345"] },
                "00080008": { vr: "CS", Value: ["ORIGINAL", "PRIMARY"] },
                "00200013": { vr: "IS", Value: [7] },
                "00081110": {
                    vr: "SQ",
                    Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
                }
            }
        };
        const jsonSource = {
            "00100020": { vr: "LO", Value: ["12345"] },
            "00080008": { vr: "CS", Value: ["ORIGINAL", "PRIMARY"] },
            "00200013": { vr: "IS", Value: [7] },
            "00081110": {
                vr: "SQ",
                Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
            }
        };

        const { fromDicomWebJson } = await import(
            "../../src/eventStream/fromDicomWebJson"
        );
        const fromDict = await naturalizeFrom(l => fromDataSet(dictSource, l));
        const fromJson = await naturalizeFrom(l =>
            fromDicomWebJson(jsonSource, l)
        );
        expect(fromJson).toEqual(fromDict);
        // (fromDict is the normalized form: single-item sequences are flattened
        // to [item], so assert on that shape.)
        expect(fromDict.OtherPatientIDs).toBeUndefined();
        expect(fromDict.ImageType).toEqual(["ORIGINAL", "PRIMARY"]);
        expect(fromDict.ReferencedStudySequence[0].ReferencedSOPClassUID).toBe(
            "1.2.3"
        );
    });
});

describe("NaturalizedListener — Person Name proxy (§17)", () => {
    test("VM-1 PN exposes components and stringifies to the raw PN string", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startElement("00100010", { vr: "PN" }); // PatientName, VM 1
        l.value({ Alphabetic: "Doe^Jane" });
        l.endElement();
        l.endDataSet();

        expect(l.result.PatientName.Alphabetic).toBe("Doe^Jane");
        expect(String(l.result.PatientName)).toBe("Doe^Jane");
        // toJSON serializes to the DICOM JSON model (PN Value is an array of
        // component objects), matching dcmjs's existing convention.
        expect(JSON.parse(JSON.stringify(l.result.PatientName))).toEqual([
            { Alphabetic: "Doe^Jane" }
        ]);
    });

    test("VM-n PN is an array that stringifies with the value delimiter", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startElement("00101001", { vr: "PN" }); // OtherPatientNames, VM 1-n
        l.value({ Alphabetic: "Doe^John" });
        l.value({ Alphabetic: "Doe^Jane" });
        l.endElement();
        l.endDataSet();

        expect(Array.isArray(l.result.OtherPatientNames)).toBe(true);
        expect(l.result.OtherPatientNames).toHaveLength(2);
        expect(l.result.OtherPatientNames[0].Alphabetic).toBe("Doe^John");
        expect(String(l.result.OtherPatientNames)).toBe("Doe^John\\Doe^Jane");
    });

    test("present-empty PN stays null", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startElement("00100010", { vr: "PN" });
        l.endElement();
        l.endDataSet();
        expect(l.result.PatientName).toBeNull();
    });
});

describe("NaturalizedListener — private-tag grouping (§18)", () => {
    test("groups a reserved block under <group>:<creator>, with xEE keys and VRs", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        scalar(l, "00290010", "LO", "ACME_PRIVATE_1.0"); // creator, block 0x10
        scalar(l, "00291010", "LO", "acme-value");
        scalar(l, "00291011", "LO", "acme-value-2");
        l.endDataSet();

        expect(l.result).toEqual({
            _vrMap: { "0029:ACME_PRIVATE_1.0": { x10: "LO", x11: "LO" } },
            "0029:ACME_PRIVATE_1.0": {
                creator: "ACME_PRIVATE_1.0",
                reservedBlock: 0x10,
                x10: "acme-value",
                x11: "acme-value-2"
            }
        });
        // the hex tags stay readable as non-enumerable aliases
        expect(l.result["00290010"]).toBe("ACME_PRIVATE_1.0");
        expect(l.result["00291010"]).toBe("acme-value");
    });

    test("a private dictionary keyword is a non-enumerable alias in the block (§18.2)", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        scalar(l, "00290010", "LO", "SIEMENS CSA HEADER");
        scalar(l, "00291010", "OB", "csa"); // (0029,1010) -> CSAImageHeaderInfo
        scalar(l, "00291099", "LO", "x"); // not in the private dictionary
        l.endDataSet();

        const block = l.result["0029:SIEMENS CSA HEADER"];
        expect(Object.keys(block)).toEqual([
            "creator",
            "reservedBlock",
            "x10",
            "x99"
        ]);
        expect(block.CSAImageHeaderInfo).toBe("csa");
        // the keyword stays scoped to its block
        expect("CSAImageHeaderInfo" in l.result).toBe(false);
    });

    test("private data without a creator keeps its hex tag, with the VR in _vrMap (§18.4)", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        scalar(l, "00291020", "UN", "orphan"); // no creator for block 0x10
        l.endDataSet();

        expect(l.result["00291020"]).toBe("orphan");
        expect(l.result._vrMap["00291020"]).toBe("UN");
    });

    test("private grouping is scoped per dataset level (sequence items have their own creators)", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        scalar(l, "00290010", "LO", "ROOT CREATOR");
        scalar(l, "00291010", "LO", "root");
        l.startSequence("00400100", { vr: "SQ" }); // ScheduledProcedureStepSequence
        l.startItem({});
        scalar(l, "00290010", "LO", "ITEM CREATOR");
        scalar(l, "00291010", "LO", "item");
        l.endItem();
        l.endSequence();
        l.endDataSet();

        expect(l.result["0029:ROOT CREATOR"].x10).toBe("root");
        const item = l.result.ScheduledProcedureStepSequence;
        expect(item["0029:ITEM CREATOR"].x10).toBe("item");
    });
});

describe("NaturalizedListener — precision / raw retention (§16)", () => {
    test("retains the raw string for a decimal the JS number cannot reproduce", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startElement("00180050", { vr: "DS" }); // SliceThickness, DS
        // 16-char DS; the double rounds to ...992, losing the last digit.
        l.value(9007199254740993, { rawValue: "9007199254740993" });
        l.endElement();
        l.endDataSet();
        expect(l.result.SliceThickness).toBe("9007199254740993");
    });

    test("keeps the number for exactly-representable decimals (incl. trailing zeros)", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startElement("00180050", { vr: "DS" });
        l.value(1.5, { rawValue: "1.50" }); // recoverable as 1.5
        l.endElement();
        l.endDataSet();
        expect(l.result.SliceThickness).toBe(1.5);
    });

    test("without a raw value (e.g. DICOMweb JSON) the number is kept as-is", () => {
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startElement("00180050", { vr: "DS" });
        l.value(9007199254740993); // no rawValue available
        l.endElement();
        l.endDataSet();
        expect(typeof l.result.SliceThickness).toBe("number");
    });
});

describe("NaturalizedListener — precision end-to-end through generators", () => {
    const { DicomDict } = dcmjs.data;

    function buildLossyDsPart10() {
        const meta = {
            "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] },
            "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
            "00020003": { vr: "UI", Value: ["1.2.3.4.5"] }
        };
        const dd = new DicomDict(meta);
        // 16-char DS whose double representation loses the final digit.
        dd.dict = { "00180050": { vr: "DS", Value: ["9007199254740993"] } };
        return dd.write();
    }

    test("lossy DS retains its raw string from raw bytes (fromPart10)", async () => {
        const buffer = buildLossyDsPart10();
        const l = new NaturalizedListener();
        await fromPart10(buffer.slice(0), l);
        expect(l.result.SliceThickness).toBe("9007199254740993");
    });

    test("lossy DS retains its raw string from a dict (fromDataSet)", async () => {
        const buffer = buildLossyDsPart10();
        const dict = DicomMessage.readFile(buffer.slice(0));
        const l = new NaturalizedListener();
        await fromDataSet({ meta: dict.meta, dict: dict.dict }, l);
        expect(l.result.SliceThickness).toBe("9007199254740993");
    });
});
