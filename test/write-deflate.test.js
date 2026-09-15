import fs from "fs";
import path from "path";
import pako from "pako";
import dicomParser from "dicom-parser";
import dcmjs from "../src/index.js";
import { collectSectionProblems } from "./helper/equivalence.js";

const { DicomMessage } = dcmjs.data;

/**
 * W4 (docs roadmap R4) - deflate-on-write, transfer syntax
 * 1.2.840.10008.1.2.1.99.
 *
 * DicomDict.write now produces deflated part-10 streams: preamble, "DICM"
 * and the meta group are written UNCOMPRESSED (PS3.10 A.5 - the meta group
 * is never deflated), then the body is produced as explicit little endian
 * (the deflated syntax implies an ELE body) and appended raw-deflated
 * (RFC 1951, pako.deflateRaw - the mirror of the read side's inflateRaw).
 *
 * PASSTHROUGH INTERPLAY (task item 3): the deflated syntax differs from
 * plain ELE only in the stream-level deflate wrapper, so the W3
 * passthrough gate compares BODY syntaxes. A deflated source's
 * `_sourceSpan`s index the INFLATED body buffer, and DicomDict.write hands
 * DicomMessage.write the PRE-deflate body stream - so clean entries pass
 * through verbatim in every deflated/ELE source-target combination:
 *   deflated -> deflated : spans (inflated bytes) -> pre-deflate stream
 *   ELE      -> deflated : spans (source bytes)   -> pre-deflate stream
 *   deflated -> ELE      : spans (inflated bytes) -> output stream
 * Each combination is asserted below as pre-deflate/uncompressed body
 * byte-identity. The output FILE of a deflated target is never compared
 * byte-for-byte against a deflated source: the deflate wrapper bytes
 * depend on the encoder.
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
        "parser",
        "testImages",
        "deflate",
        name
    )
]);

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
 * written uncompressed.
 */
function bodyStartOf(bytes) {
    const ascii = String.fromCharCode(...bytes.subarray(128, 132));
    if (ascii !== "DICM") {
        throw new Error("not a part-10 stream");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    if (
        view.getUint16(132, true) !== 0x0002 ||
        view.getUint16(134, true) !== 0
    ) {
        throw new Error("meta group length element missing");
    }
    return 144 + view.getUint32(140, true);
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

function readLazy(arrayBuffer, options = {}) {
    return DicomMessage.readFile(arrayBuffer, { ...options, core: "lazy" });
}

/** Re-reads written bytes with both cores and hands each dict to verify. */
function rereadWithBothCores(outBytes, verify) {
    for (const core of ["eager", "lazy"]) {
        verify(
            DicomMessage.readFile(
                outBytes.buffer.slice(
                    outBytes.byteOffset,
                    outBytes.byteOffset + outBytes.byteLength
                ),
                { core }
            ),
            core
        );
    }
}

describe("W4 deflate-on-write: deflated source round-trip", () => {
    DEFLATE_FIXTURES.forEach(([name, fullPath]) => {
        it(`round-trips ${name}: write back deflated, re-read with both cores`, () => {
            const arrayBuffer = readFixture(fullPath);
            const srcBytes = new Uint8Array(arrayBuffer);
            const original = readLazy(arrayBuffer);
            expect(original._lazyWriteContext.sourceSyntax).toBe(
                DEFLATED_EXPLICIT_LITTLE_ENDIAN
            );
            // no 0008,0005 in these fixtures, so the dict-level
            // passthrough gate is open - the byte-identity below proves
            // the W3 passthrough composes with re-deflation
            expect(original._lazyWriteContext.charsetPassthroughSafe).toBe(
                true
            );

            const out = new Uint8Array(original.write());

            // the meta group is uncompressed and well-formed (bodyStartOf
            // parses the group length element), the body is a raw deflate
            // stream whose inflation is byte-identical to the INFLATED
            // source body the lazy spans index
            const inflatedBody = pako.inflateRaw(
                out.subarray(bodyStartOf(out))
            );
            expectIdenticalBytes(
                inflatedBody,
                pako.inflateRaw(srcBytes.subarray(bodyStartOf(srcBytes))),
                `${name}: pre-deflate body vs inflated source body`
            );

            rereadWithBothCores(out, (reread, core) => {
                expect(reread.meta[TRANSFER_SYNTAX_UID].Value).toEqual([
                    DEFLATED_EXPLICIT_LITTLE_ENDIAN
                ]);
                expect(
                    collectSectionProblems(
                        original.dict,
                        reread.dict,
                        `${name} dict (${core})`,
                        []
                    )
                ).toEqual([]);
                expect(
                    collectSectionProblems(
                        original.meta,
                        reread.meta,
                        `${name} meta (${core})`,
                        []
                    )
                ).toEqual([]);
            });
        });
    });

    it("re-encodes an edited element into the pre-deflate stream (image_dfl)", () => {
        const [, fullPath] = DEFLATE_FIXTURES[0];
        const original = readLazy(readFixture(fullPath));
        const expectedDict = readLazy(readFixture(fullPath)).dict;

        const entry = original.dict["00100010"];
        expect(entry).toBeDefined();
        const newName = "Deflated^Rewritten";
        entry.Value = [newName];

        const out = new Uint8Array(original.write());
        rereadWithBothCores(out, (reread, core) => {
            expect(reread.dict["00100010"].Value[0].Alphabetic).toBe(newName);
            const rereadWithoutEdit = { ...reread.dict };
            const sourceWithoutEdit = { ...expectedDict };
            delete rereadWithoutEdit["00100010"];
            delete sourceWithoutEdit["00100010"];
            expect(
                collectSectionProblems(
                    sourceWithoutEdit,
                    rereadWithoutEdit,
                    `edited image_dfl dict minus edit (${core})`,
                    []
                )
            ).toEqual([]);
        });
    });
});

describe("W4 deflate-on-write: non-deflated source written as deflated", () => {
    it("converts sample-sr.dcm (ELE) to deflated and round-trips with both cores", () => {
        const arrayBuffer = readFixture(path.join(__dirname, "sample-sr.dcm"));
        const original = readLazy(arrayBuffer);
        expect(original._lazyWriteContext.sourceSyntax).toBe(
            EXPLICIT_LITTLE_ENDIAN
        );
        expect(original._lazyWriteContext.charsetPassthroughSafe).toBe(true);

        // DicomDict.upsertTag targets the body dict, so the meta
        // TransferSyntaxUID is rewritten through its Value accessor (the
        // meta group is always re-encoded on write).
        original.meta[TRANSFER_SYNTAX_UID].Value = [
            DEFLATED_EXPLICIT_LITTLE_ENDIAN
        ];

        const out = new Uint8Array(original.write());

        // ELE -> deflated differs only in the deflate wrapper: body syntax
        // is ELE on both sides, so clean entries pass through into the
        // pre-deflate stream - inflating the output body recovers the
        // source body byte-for-byte (sample-sr already stores ISO_IR 192,
        // so the re-encoded 0008,0005 element is a byte no-op)
        const srcBytes = new Uint8Array(arrayBuffer);
        const inflatedBody = pako.inflateRaw(out.subarray(bodyStartOf(out)));
        expectIdenticalBytes(
            inflatedBody,
            srcBytes.subarray(bodyStartOf(srcBytes)),
            "sample-sr: pre-deflate body vs source body"
        );

        rereadWithBothCores(out, (reread, core) => {
            expect(reread.meta[TRANSFER_SYNTAX_UID].Value).toEqual([
                DEFLATED_EXPLICIT_LITTLE_ENDIAN
            ]);
            expect(
                collectSectionProblems(
                    original.dict,
                    reread.dict,
                    `sample-sr dict (${core})`,
                    []
                )
            ).toEqual([]);
            // meta round-trips too, except the rewritten TransferSyntaxUID
            // entry whose stale _rawValue still holds the source syntax
            const originalMeta = { ...original.meta };
            const rereadMeta = { ...reread.meta };
            delete originalMeta[TRANSFER_SYNTAX_UID];
            delete rereadMeta[TRANSFER_SYNTAX_UID];
            expect(
                collectSectionProblems(
                    originalMeta,
                    rereadMeta,
                    `sample-sr meta minus TS (${core})`,
                    []
                )
            ).toEqual([]);
        });
    });

    it("writes a dict without _lazyWriteContext (eager read) as deflated", () => {
        const arrayBuffer = readFixture(path.join(__dirname, "sample-sr.dcm"));
        const original = DicomMessage.readFile(arrayBuffer, {
            core: "eager"
        });
        original.meta[TRANSFER_SYNTAX_UID].Value = [
            DEFLATED_EXPLICIT_LITTLE_ENDIAN
        ];

        const out = new Uint8Array(original.write());
        rereadWithBothCores(out, (reread, core) => {
            expect(reread.meta[TRANSFER_SYNTAX_UID].Value).toEqual([
                DEFLATED_EXPLICIT_LITTLE_ENDIAN
            ]);
            expect(
                collectSectionProblems(
                    original.dict,
                    reread.dict,
                    `eager-read sample-sr dict (${core})`,
                    []
                )
            ).toEqual([]);
        });
    });
});

describe("W4 deflate-on-write: deflated source written as uncompressed ELE", () => {
    it("converts wave_dfl to plain ELE with cross-wrapper passthrough", () => {
        const [, fullPath] = DEFLATE_FIXTURES[2];
        const arrayBuffer = readFixture(fullPath);
        const srcBytes = new Uint8Array(arrayBuffer);
        const original = readLazy(arrayBuffer);
        expect(original._lazyWriteContext.sourceSyntax).toBe(
            DEFLATED_EXPLICIT_LITTLE_ENDIAN
        );

        original.meta[TRANSFER_SYNTAX_UID].Value = [EXPLICIT_LITTLE_ENDIAN];

        const out = new Uint8Array(original.write());

        // deflated -> ELE: the spans index the INFLATED body, which is
        // exactly the ELE body the target wants - clean entries pass
        // through verbatim into the (uncompressed) output stream
        expectIdenticalBytes(
            out.subarray(bodyStartOf(out)),
            pako.inflateRaw(srcBytes.subarray(bodyStartOf(srcBytes))),
            "wave_dfl: ELE output body vs inflated source body"
        );

        rereadWithBothCores(out, (reread, core) => {
            expect(reread.meta[TRANSFER_SYNTAX_UID].Value).toEqual([
                EXPLICIT_LITTLE_ENDIAN
            ]);
            expect(
                collectSectionProblems(
                    original.dict,
                    reread.dict,
                    `wave_dfl as ELE dict (${core})`,
                    []
                )
            ).toEqual([]);
        });
    });
});

describe("W4 deflate-on-write: published dicom-parser reads the output", () => {
    /**
     * The published dicom-parser package (devDependency, not the vendored
     * @dcmjs/parser) must be able to read the written stream: in Node its
     * zlib path inflates when handed a Buffer, and the browser-equivalent
     * route is an explicit pako-based inflater option. The published
     * parser expects the inflater to return header + inflated body
     * (it continues reading the dataset at `position` of the returned
     * buffer, unlike the vendored parser's body-only contract).
     */
    function pakoInflaterForPublishedParser(byteArray, position) {
        const inflated = pako.inflateRaw(byteArray.subarray(position));
        const full = new Uint8Array(position + inflated.length);
        full.set(byteArray.subarray(0, position), 0);
        full.set(inflated, position);
        return full;
    }

    DEFLATE_FIXTURES.forEach(([name, fullPath]) => {
        it(`parses the rewritten ${name} via zlib (Buffer) and via a pako inflater`, () => {
            const original = readLazy(readFixture(fullPath));
            const out = new Uint8Array(original.write());

            const parsed = [
                // Node path: zlib-backed, requires a Buffer
                dicomParser.parseDicom(Buffer.from(out)),
                // explicit inflater path over a plain Uint8Array
                dicomParser.parseDicom(out, {
                    inflater: pakoInflaterForPublishedParser
                })
            ];

            for (const dataSet of parsed) {
                // the uncompressed meta group is fully readable
                expect(dataSet.string("x00020010")).toBe(
                    DEFLATED_EXPLICIT_LITTLE_ENDIAN
                );
                expect(dataSet.string("x00020002")).toBe(
                    original.meta["00020002"].Value[0]
                );
                expect(dataSet.string("x00020003")).toBe(
                    original.meta["00020003"].Value[0]
                );
                // and the inflated body agrees with the original read
                expect(dataSet.string("x00080018")).toBe(
                    original.dict["00080018"].Value[0]
                );
            }
        });
    });
});
