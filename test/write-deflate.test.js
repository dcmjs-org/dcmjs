import fs from "fs";
import path from "path";
import pako from "pako";
import dcmjs from "../src/index.js";
import { fromPart10Stream } from "../src/eventStream/fromPart10Stream.js";
import { CollectorListener } from "../src/eventStream/CollectorListener.js";
import { collectSectionProblems, deepCompare } from "./helper/equivalence.js";
import { datasetStart } from "./issues/part10Walker.js";

const { DicomMessage, DicomDict } = dcmjs.data;

/**
 * Deflate-on-write (the W4 slice of the writers wave), transfer syntax
 * 1.2.840.10008.1.2.1.99 — ported from the v2 rewrite's
 * test/write-deflate.test.js and adapted to this branch:
 *
 *   - no lazy core / `_lazyWriteContext` here, so the v2 passthrough
 *     byte-identity assertions against the SOURCE body are replaced by a
 *     core-valid one: inflating the deflated output body must be
 *     byte-identical to writing the same dict as plain ELE (the encoder is
 *     deterministic, and the deflated syntax implies an ELE body);
 *   - the v2 "both cores" re-read (eager + lazy) becomes this branch's two
 *     read paths: eager `DicomMessage.readFile` and the streaming
 *     `fromPart10Stream` (which inflates incrementally via pako);
 *   - the v2 `@dcmjs/parser` / published dicom-parser cross-checks are
 *     replaced by the independent test/issues/part10Walker.js, which parses
 *     the uncompressed meta group without any dcmjs read code.
 *
 * DicomDict.write produces deflated part-10 streams: preamble, "DICM" and
 * the meta group are written UNCOMPRESSED (PS3.10 A.5 — the meta group is
 * never deflated), then the body is produced as explicit little endian and
 * appended raw-deflated (RFC 1951, pako.deflateRaw — the mirror of the read
 * side's inflateRaw).
 */

const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";
const DEFLATED_EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1.99";
const TRANSFER_SYNTAX_UID = "00020010";

const DEFLATE_FIXTURES = ["image_dfl", "report_dfl", "wave_dfl"].map(name => [
    name,
    path.join(
        __dirname,
        "..",
        "packages",
        "fixtures",
        "testImages",
        "deflate",
        name
    )
]);

const FIXTURE_ELE = path.join(
    __dirname,
    "..",
    "packages",
    "fixtures",
    "testImages",
    "CT1_UNC.explicit_little_endian.dcm"
);

/** Exact ArrayBuffer of the file contents (no Node buffer-pool aliasing). */
function readFixture(fullPath) {
    const buffer = fs.readFileSync(fullPath);
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );
}

/**
 * Offset of the first body byte of a part-10 stream: preamble (128) +
 * "DICM" (4) + the (0002,0000) FileMetaInformationGroupLength element
 * (12 bytes, explicit little endian UL) + the meta group it measures.
 * Succeeding on a deflated output also proves the meta group itself was
 * written uncompressed: part10Walker reads it with plain ELE offsets and
 * no dcmjs read code.
 */
function bodyStartOf(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    if (
        view.getUint16(132, true) !== 0x0002 ||
        view.getUint16(134, true) !== 0
    ) {
        throw new Error("meta group length element missing");
    }
    return datasetStart(bytes);
}

/** First index at which the byte sequences differ, or -1 when identical. */
function firstDifference(a, b) {
    const minLength = Math.min(a.length, b.length);
    for (let i = 0; i < minLength; i++) {
        if (a[i] !== b[i]) {
            return i;
        }
    }
    return a.length === b.length ? -1 : minLength;
}

function hexContext(bytes, offset) {
    const start = Math.max(0, offset - 8);
    return Array.from(bytes.subarray(start, start + 32))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join(" ");
}

function expectIdenticalBytes(actual, expected, label) {
    const diff = firstDifference(actual, expected);
    if (diff !== -1) {
        throw new Error(
            `${label}: bytes diverge at offset ${diff} ` +
                `(actual length ${actual.length}, expected length ${expected.length})\n` +
                `  actual   [${Math.max(0, diff - 8)}..]: ${hexContext(
                    actual,
                    diff
                )}\n` +
                `  expected [${Math.max(0, diff - 8)}..]: ${hexContext(
                    expected,
                    diff
                )}`
        );
    }
}

function toArrayBuffer(bytes) {
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
    );
}

/** Streaming re-read: fromPart10Stream into a CollectorListener. */
async function streamRead(arrayBuffer) {
    const listener = new CollectorListener();
    await fromPart10Stream(arrayBuffer, listener);
    return listener.result;
}

/**
 * Compares two same-reader dict sections on vr + Value only (raw bytes may
 * legitimately differ across a re-encode, e.g. padding).
 */
function expectSameValues(expected, actual, where) {
    const problems = [];
    const expectedTags = Object.keys(expected).sort();
    deepCompare(
        expectedTags,
        Object.keys(actual).sort(),
        `${where} tags`,
        problems
    );
    for (const tag of expectedTags) {
        deepCompare(
            expected[tag]?.vr,
            actual[tag]?.vr,
            `${where}.${tag}.vr`,
            problems
        );
        deepCompare(
            expected[tag]?.Value,
            actual[tag]?.Value,
            `${where}.${tag}.Value`,
            problems
        );
    }
    expect(problems).toEqual([]);
}

/**
 * Re-reads written bytes with both read paths (eager readFile and the
 * streaming fromPart10Stream) and hands each {meta, dict} to verify.
 */
async function rereadWithBothReaders(outBytes, verify) {
    const eager = DicomMessage.readFile(toArrayBuffer(outBytes));
    verify(eager.meta, eager.dict, "eager");
    const streamed = await streamRead(toArrayBuffer(outBytes));
    verify(streamed.meta, streamed.dict, "stream");
}

/**
 * The deflated output body, inflated, must equal the plain-ELE encoding of
 * the same dict — the deflated syntax is the ELE body in a deflate wrapper.
 */
function expectBodyIsDeflatedEle(dicomDict, outBytes, label) {
    const inflatedBody = pako.inflateRaw(
        outBytes.subarray(bodyStartOf(outBytes))
    );
    dicomDict.meta[TRANSFER_SYNTAX_UID].Value = [EXPLICIT_LITTLE_ENDIAN];
    const eleBytes = new Uint8Array(dicomDict.write());
    dicomDict.meta[TRANSFER_SYNTAX_UID].Value = [
        DEFLATED_EXPLICIT_LITTLE_ENDIAN
    ];
    expectIdenticalBytes(
        inflatedBody,
        eleBytes.subarray(bodyStartOf(eleBytes)),
        `${label}: inflated output body vs plain-ELE body of the same dict`
    );
}

describe("W4 deflate-on-write: deflated source round-trip", () => {
    DEFLATE_FIXTURES.forEach(([name, fullPath]) => {
        it(`round-trips ${name}: write back deflated, re-read with both readers`, async () => {
            const original = DicomMessage.readFile(readFixture(fullPath));
            expect(original.meta[TRANSFER_SYNTAX_UID].Value).toEqual([
                DEFLATED_EXPLICIT_LITTLE_ENDIAN
            ]);

            const out = new Uint8Array(original.write());

            // the body is a raw deflate stream (inflateRaw throws on the
            // uncompressed body a deflate-less writer would emit), and it
            // is exactly the ELE encoding of the dict in a deflate wrapper
            expectBodyIsDeflatedEle(original, out, name);

            // eager re-read round-trips the dict losslessly (same reader on
            // both sides, so _rawValue participates too)
            const rereadEager = DicomMessage.readFile(toArrayBuffer(out));
            expect(rereadEager.meta[TRANSFER_SYNTAX_UID].Value).toEqual([
                DEFLATED_EXPLICIT_LITTLE_ENDIAN
            ]);
            expect(
                collectSectionProblems(
                    original.dict,
                    rereadEager.dict,
                    `${name} dict (eager)`,
                    []
                )
            ).toEqual([]);

            // the streaming reader inflates the same bytes incrementally:
            // stream(original) and stream(rewritten) agree on vr + Value
            const streamedOriginal = await streamRead(readFixture(fullPath));
            const streamedReread = await streamRead(toArrayBuffer(out));
            expect(streamedReread.meta[TRANSFER_SYNTAX_UID].Value).toEqual([
                DEFLATED_EXPLICIT_LITTLE_ENDIAN
            ]);
            expectSameValues(
                streamedOriginal.dict,
                streamedReread.dict,
                `${name} dict (stream)`
            );
        });
    });

    it("re-encodes an edited element under the deflate wrapper (image_dfl)", async () => {
        const [, fullPath] = DEFLATE_FIXTURES[0];
        const original = DicomMessage.readFile(readFixture(fullPath));

        const entry = original.dict["00100010"];
        expect(entry).toBeDefined();
        const newName = "Deflated^Rewritten";
        entry.Value = [newName];

        const out = new Uint8Array(original.write());
        await rereadWithBothReaders(out, (meta, dict, reader) => {
            expect(meta[TRANSFER_SYNTAX_UID].Value).toEqual([
                DEFLATED_EXPLICIT_LITTLE_ENDIAN
            ]);
            const got = dict["00100010"].Value[0];
            expect(got.Alphabetic ?? got).toBe(newName);
            expect(dict["00080018"].Value).toEqual(
                original.dict["00080018"].Value
            );
            expect(reader).toMatch(/eager|stream/);
        });
    });
});

describe("W4 deflate-on-write: non-deflated source written as deflated", () => {
    it("converts CT1_UNC (ELE) to deflated and round-trips with both readers", async () => {
        const original = DicomMessage.readFile(readFixture(FIXTURE_ELE));
        expect(original.meta[TRANSFER_SYNTAX_UID].Value).toEqual([
            EXPLICIT_LITTLE_ENDIAN
        ]);

        original.meta[TRANSFER_SYNTAX_UID].Value = [
            DEFLATED_EXPLICIT_LITTLE_ENDIAN
        ];
        const out = new Uint8Array(original.write());

        expectBodyIsDeflatedEle(original, out, "CT1_UNC");

        const reread = DicomMessage.readFile(toArrayBuffer(out));
        expect(reread.meta[TRANSFER_SYNTAX_UID].Value).toEqual([
            DEFLATED_EXPLICIT_LITTLE_ENDIAN
        ]);
        // (0008,0005) is exempt across the write suites: the writer
        // transcodes strings to UTF-8 and rewrites it to ISO_IR 192.
        const originalDict = { ...original.dict };
        const rereadDict = { ...reread.dict };
        delete originalDict["00080005"];
        delete rereadDict["00080005"];
        expect(
            collectSectionProblems(
                originalDict,
                rereadDict,
                "CT1_UNC as deflated dict (eager)",
                []
            )
        ).toEqual([]);

        const streamed = await streamRead(toArrayBuffer(out));
        expect(streamed.meta[TRANSFER_SYNTAX_UID].Value).toEqual([
            DEFLATED_EXPLICIT_LITTLE_ENDIAN
        ]);
        expect(streamed.dict["00080018"].Value).toEqual(
            original.dict["00080018"].Value
        );
    });

    it("writes a freshly-built DicomDict as deflated", async () => {
        const dicomDict = new DicomDict({
            "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
            "00020003": { vr: "UI", Value: ["1.2.3.4.5"] },
            [TRANSFER_SYNTAX_UID]: {
                vr: "UI",
                Value: [DEFLATED_EXPLICIT_LITTLE_ENDIAN]
            }
        });
        dicomDict.upsertTag("00080018", "UI", ["1.2.3.4.5"]);
        dicomDict.upsertTag("00100010", "PN", [{ Alphabetic: "Doe^Jane" }]);
        dicomDict.upsertTag("00100020", "LO", ["12345"]);

        const out = new Uint8Array(dicomDict.write());
        expectBodyIsDeflatedEle(dicomDict, out, "fresh dict");

        await rereadWithBothReaders(out, (meta, dict) => {
            expect(meta[TRANSFER_SYNTAX_UID].Value).toEqual([
                DEFLATED_EXPLICIT_LITTLE_ENDIAN
            ]);
            expect(dict["00100020"].Value).toEqual(["12345"]);
            expect(dict["00080018"].Value).toEqual(["1.2.3.4.5"]);
            const pn = dict["00100010"].Value[0];
            expect(pn.Alphabetic ?? pn).toBe("Doe^Jane");
        });
    });
});

describe("W4 deflate-on-write: deflated source written as uncompressed ELE", () => {
    it("converts wave_dfl to plain ELE", async () => {
        const [, fullPath] = DEFLATE_FIXTURES[2];
        const original = DicomMessage.readFile(readFixture(fullPath));

        original.meta[TRANSFER_SYNTAX_UID].Value = [EXPLICIT_LITTLE_ENDIAN];
        const out = new Uint8Array(original.write());

        // the output body is NOT deflated: the first body bytes are a plain
        // ELE element header, which a raw-deflate inflater rejects
        expect(() => pako.inflateRaw(out.subarray(bodyStartOf(out)))).toThrow();

        await rereadWithBothReaders(out, (meta, dict) => {
            expect(meta[TRANSFER_SYNTAX_UID].Value).toEqual([
                EXPLICIT_LITTLE_ENDIAN
            ]);
            expect(dict["00080018"].Value).toEqual(
                original.dict["00080018"].Value
            );
        });
    });
});
