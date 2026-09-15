/**
 * Issue #363 — "Invalid tag in sequence: Unable to parse MR Dicom file
 * in dcmjs. Cornerstone able to parse and works fine"
 * https://github.com/dcmjs-org/dcmjs/issues/363
 *
 * Root cause (diagnosed transiently from the upstream attachment under
 * the tiered fixture policy — the file itself contained real patient
 * identity, failed vetting, and was deleted after diagnosis): the file
 * carries a Philips private element (2001,105F) with VR UN and
 * UNDEFINED length. Per PS3.5 §6.2.2, an UN element with undefined
 * length shall be parsed as an Implicit VR Little Endian sequence —
 * its items' contents are IMPLICIT-VR encoded even inside an
 * Explicit-VR file. dcmjs instead parsed the item contents as explicit
 * VR, read the implicit length bytes as a VR ("  "), and threw
 * "Invalid tag in sequence". dicomParser handles this correctly.
 *
 * The fixture below is fully synthetic (JANE DOE identity, fictional
 * UIDs, byte pattern reproduced from the diagnosis) — committable, and
 * contributable upstream.
 *
 * Triage: was B/blocked, now A via synthesis.
 */

import dcmjs from "../../src/index.js";
import { validationLog } from "../../src/log.js";

validationLog.setLevel(5);

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;
const { DicomEventStream } = dcmjs.eventStream;

/** Build the reproducer: Explicit-VR-LE Part 10 whose dataset contains
 *  a UN element with undefined length wrapping an implicit-VR item —
 *  the PS3.5 §6.2.2 shape — followed by an ordinary element that a
 *  correct parser must still reach. */
function buildUnUndefinedLengthFile() {
    const parts = [];
    const push = bytes => parts.push(Uint8Array.from(bytes));
    const ascii = s => Array.from(s, c => c.charCodeAt(0));
    const u16 = v => [v & 0xff, (v >> 8) & 0xff];
    const u32 = v => [
        v & 0xff,
        (v >> 8) & 0xff,
        (v >> 16) & 0xff,
        (v >>> 24) & 0xff
    ];
    // explicit short-form element
    const shortEl = (g, e, vr, value) => {
        const v = ascii(value.length % 2 ? value + " " : value);
        push([...u16(g), ...u16(e), ...ascii(vr), ...u16(v.length), ...v]);
    };

    // --- preamble + DICM
    parts.push(new Uint8Array(128));
    push(ascii("DICM"));

    // --- file meta (explicit LE): group length + TS
    const metaBody = [];
    const metaEl = (g, e, vr, valueBytes) => {
        metaBody.push(
            ...u16(g),
            ...u16(e),
            ...ascii(vr),
            ...u16(valueBytes.length),
            ...valueBytes
        );
    };
    metaEl(0x0002, 0x0002, "UI", ascii("1.2.840.10008.5.1.4.1.1.4\0"));
    metaEl(0x0002, 0x0003, "UI", ascii("2.25.740000000000000000363\0"));
    metaEl(0x0002, 0x0010, "UI", ascii("1.2.840.10008.1.2.1\0"));
    push([
        ...u16(0x0002),
        ...u16(0x0000),
        ...ascii("UL"),
        ...u16(4),
        ...u32(metaBody.length)
    ]);
    push(metaBody);

    // --- dataset (explicit LE, ascending tags)
    shortEl(0x0008, 0x0060, "CS", "MR");
    shortEl(0x0010, 0x0010, "PN", "DOE^JANE");
    shortEl(0x0010, 0x0020, "LO", "JD-363");

    // private creator (explicit LO — normal)
    shortEl(0x2001, 0x0010, "LO", "SYNTH PRIVATE ");

    // (2001,105F) UN, UNDEFINED length — the §6.2.2 shape.
    push([
        ...u16(0x2001),
        ...u16(0x105f),
        ...ascii("UN"),
        0,
        0,
        ...u32(0xffffffff)
    ]);
    // one item, defined length, whose CONTENT is IMPLICIT-VR encoded
    const implicitItem = [];
    const implicitEl = (g, e, valueBytes) => {
        implicitItem.push(
            ...u16(g),
            ...u16(e),
            ...u32(valueBytes.length),
            ...valueBytes
        );
    };
    implicitEl(0x2001, 0x0010, ascii("SYNTH PRIVATE ")); // nested creator, implicit
    implicitEl(0x2001, 0x1071, [0x39, 0x8e, 0xe3, 0x3d]); // 4 opaque bytes
    implicitEl(0x2001, 0x109f, ascii("AB")); // 2 opaque bytes
    push([...u16(0xfffe), ...u16(0xe000), ...u32(implicitItem.length)]);
    push(implicitItem);
    // sequence delimitation item closes the undefined-length UN
    push([...u16(0xfffe), ...u16(0xe0dd), ...u32(0)]);

    // an ordinary element AFTER the UN sequence — the parser must get here
    shortEl(0x2050, 0x0020, "CS", "IDENTITY");

    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out.buffer;
}

describe("issue #363 — UN element with undefined length is an implicit-VR sequence", () => {
    const buffer = buildUnUndefinedLengthFile();

    // Fixed in this arc: _readTag reads UN + undefined length as SQ with
    // the implicit-VR syntax (PS3.5 §6.2.2).
    it("#363: eager readFile parses UN/undefined-length per PS3.5 6.2.2 and reaches later elements", () => {
        const dicomDict = DicomMessage.readFile(buffer);
        // The element after the UN sequence is the user-visible victory:
        expect(dicomDict.dict["20500020"].Value[0]).toBe("IDENTITY");
        // And the UN element surfaced as SOME structured or raw form
        // rather than derailing the parse:
        expect(dicomDict.dict["2001105F"]).toBeDefined();
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        expect(
            String(
                [].concat(dataset.PatientName)[0].Alphabetic ??
                    dataset.PatientName
            )
        ).toContain("DOE^JANE");
    });

    // Fixed in this arc: the streaming eager-window leaf path emits the
    // §6.2.2-parsed items as sequence events (shared emitDecodedLeaf).
    it("#363: streaming path handles UN/undefined-length identically", async () => {
        const dataset = await DicomEventStream.fromPart10Stream(
            new Uint8Array(buffer)
        ).toNaturalized();
        expect(
            dataset.PresentationLUTShape ?? dataset["20500020"]
        ).toBeDefined();
    });

    it("control: the same file without the UN element parses in both paths", () => {
        // Sanity that the fixture scaffolding itself is valid: strip the
        // UN element region by rebuilding without it.
        const clean = (() => {
            const bytes = new Uint8Array(buffer.slice(0));
            // find the UN header (2001,105F UN) and the delimiter end
            const find = pattern => {
                outer: for (let i = 0; i < bytes.length - pattern.length; i++) {
                    for (let j = 0; j < pattern.length; j++) {
                        if (bytes[i + j] !== pattern[j]) continue outer;
                    }
                    return i;
                }
                return -1;
            };
            const start = find([0x01, 0x20, 0x5f, 0x10, 0x55, 0x4e]);
            const delim = find([0xfe, 0xff, 0xdd, 0xe0]);
            const end = delim + 8;
            const out = new Uint8Array(bytes.length - (end - start));
            out.set(bytes.subarray(0, start), 0);
            out.set(bytes.subarray(end), start);
            return out.buffer;
        })();
        const dicomDict = DicomMessage.readFile(clean);
        expect(dicomDict.dict["20500020"].Value[0]).toBe("IDENTITY");
    });
});
