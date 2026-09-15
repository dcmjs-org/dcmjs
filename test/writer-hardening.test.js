import fs from "fs";
import path from "path";
import { parseDicom } from "@dcmjs/parser";
import dcmjs from "../src/index.js";
import { WriteBufferStream } from "../src/BufferStream";

const { DicomDict, DicomMessage } = dcmjs.data;

/**
 * Regression suite for the four writer-hardening review findings on the R4
 * passthrough write path (recreated from the reviewer's reproduction
 * probes):
 *
 *  1. SQ structural edits (item-dict key add/delete, item push) bypass the
 *     Value/_rawValue setters and were silently dropped by passthrough -
 *     isCleanForPassthrough now structurally verifies MATERIALIZED SQ
 *     entries against the parsed element (LazyDicomReader
 *     sqStructureDiverged).
 *  2. Non-default encoding-affecting writeOptions (fragmentMultiframe:
 *     false) were silently ignored for passthrough elements -
 *     DicomMessage.write now disables passthrough for the whole dict when
 *     one is passed. allowInvalidVRLength is validation-only and must NOT
 *     disable passthrough.
 *  3. SplitDataView amplified allocations when small re-encoded writes
 *     alternate with >=64KB zero-copy windows (growth was based on
 *     byteLength including window bytes, and truncateTo stranded every
 *     chunk tail) - growth is now based on writable capacity and the
 *     truncated tail is reused by the next write.
 *  4. Tag.valueByteUpperBound used a flat 32-byte bound for bigint, so a
 *     >0xffff-digit bigint value corrupted into the backpatch path and
 *     threw instead of routing through the measured Big16 path.
 */

/** Exact ArrayBuffer of the file contents (no Node buffer-pool aliasing). */
function readFixture(fullPath) {
    const buffer = fs.readFileSync(fullPath);
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );
}

/** Reads with the lazy core; never falls back silently in these tests. */
function readLazy(arrayBuffer, options = {}) {
    return DicomMessage.readFile(arrayBuffer, { ...options, core: "lazy" });
}

function readEager(arrayBuffer, options = {}) {
    return DicomMessage.readFile(arrayBuffer, { ...options, core: "eager" });
}

/**
 * Same-length charset neutralization (mirrors write-passthrough.test.js):
 * byte-patches the 10-byte 0008,0005 value to "ISO_IR 192" so the fixture
 * becomes passthrough safe while every other byte stays untouched.
 */
function charsetNeutralizedCopy(arrayBuffer) {
    const csElement = parseDicom(new Uint8Array(arrayBuffer)).elements
        .x00080005;
    expect(csElement).toBeDefined();
    expect(csElement.length).toBe("ISO_IR 192".length);
    const copy = arrayBuffer.slice(0);
    const copyBytes = new Uint8Array(copy);
    for (let i = 0; i < "ISO_IR 192".length; i++) {
        copyBytes[csElement.dataOffset + i] = "ISO_IR 192".charCodeAt(i);
    }
    return copy;
}

const CINE_PATH = path.join(__dirname, "cine-test.dcm");
const FRAGMENTED_BOT_PATH = path.join(
    __dirname,
    "..",
    "packages",
    "parser",
    "testImages",
    "encapsulated",
    "single-frame",
    "CT1_UNC.fragmented_bot_jpeg_ls.80.dcm"
);

// cine-test.dcm: implicit LE, no 0008,0005 (passthrough safe as-is), with
// the per-frame functional groups SQ (5200,9230) whose first item holds a
// nested SQ (0020,9111 FrameContentSequence) - the structural-edit zoo.
const SQ_TAG = "52009230";
const NESTED_SQ_TAG = "00209111";

describe("writer hardening 1: setterless SQ structural edits force re-encode", () => {
    it("an item key ADDED to a materialized item dict lands in the written output", () => {
        const dicomDict = readLazy(readFixture(CINE_PATH));
        const sq = dicomDict.dict[SQ_TAG];
        const originalItemCount = sq.Value.length;
        // plain-object property write: no setter fires
        sq.Value[0]["00080050"] = { vr: "SH", Value: ["ACC123"] };

        const out = dicomDict.write();
        for (const core of ["eager", "lazy"]) {
            const reread = DicomMessage.readFile(out.slice(0), { core });
            const items = reread.dict[SQ_TAG].Value;
            expect(items.length).toBe(originalItemCount);
            expect(items[0]["00080050"].Value).toEqual(["ACC123"]);
            // the sibling items were re-encoded faithfully
            expect(Object.keys(items[1]).sort()).toEqual(
                Object.keys(sq.Value[1]).sort()
            );
        }
    });

    it("an item key DELETED from a materialized item dict is dropped from the written output", () => {
        const arrayBuffer = readFixture(CINE_PATH);
        const dicomDict = readLazy(arrayBuffer);
        const sq = dicomDict.dict[SQ_TAG];
        expect(sq.Value[0]["00289132"]).toBeDefined();
        delete sq.Value[0]["00289132"];

        const out = dicomDict.write();
        const reread = readEager(out);
        expect(reread.dict[SQ_TAG].Value[0]["00289132"]).toBeUndefined();
        // the source file really had it (the delete landed, it was not
        // missing to begin with)
        const sourceDict = readEager(arrayBuffer.slice(0));
        expect(sourceDict.dict[SQ_TAG].Value[0]["00289132"]).toBeDefined();
    });

    it("an item PUSHED onto a materialized SQ lands in the written output", () => {
        const dicomDict = readLazy(readFixture(CINE_PATH));
        const sq = dicomDict.dict[SQ_TAG];
        const originalItemCount = sq.Value.length;
        sq.Value.push({ "00080050": { vr: "SH", Value: ["A2"] } });

        const reread = readEager(dicomDict.write());
        const items = reread.dict[SQ_TAG].Value;
        expect(items.length).toBe(originalItemCount + 1);
        expect(items[originalItemCount]["00080050"].Value).toEqual(["A2"]);
    });

    it("a structural edit inside a NESTED materialized SQ item lands (recursive check)", () => {
        const dicomDict = readLazy(readFixture(CINE_PATH));
        const nested = dicomDict.dict[SQ_TAG].Value[0][NESTED_SQ_TAG];
        expect(nested.vr).toBe("SQ");
        nested.Value[0]["00200013"] = { vr: "IS", Value: [42] };

        const reread = readEager(dicomDict.write());
        expect(
            reread.dict[SQ_TAG].Value[0][NESTED_SQ_TAG].Value[0]["00200013"]
                .Value
        ).toEqual([42]);
    });

    it("a materialized but UNTOUCHED SQ still passes through byte-identical", () => {
        const arrayBuffer = readFixture(CINE_PATH);
        const dicomDict = readLazy(arrayBuffer);
        // deep materialization: top SQ items, nested SQ items, leaf value
        const leaf =
            dicomDict.dict[SQ_TAG].Value[0][NESTED_SQ_TAG].Value[0]["00209056"];
        expect(leaf.Value).toBeDefined();

        const out = new Uint8Array(dicomDict.write());
        expect(
            Buffer.from(out).equals(Buffer.from(new Uint8Array(arrayBuffer)))
        ).toBe(true);
    });

    it("the structural check is pure: a clean no-edit write materializes no body entry", () => {
        const materialized = [];
        const dicomDict = readLazy(readFixture(CINE_PATH), {
            onMaterialize: tag => materialized.push(tag)
        });
        materialized.length = 0; // drop read-time materializations (meta)
        dicomDict.write();
        const bodyMaterializations = materialized.filter(
            tag => tag.slice(0, 4) !== "0002"
        );
        expect(bodyMaterializations).toEqual([]);
    });
});

describe("writer hardening 2: non-default encoding writeOptions disable passthrough", () => {
    it("write({fragmentMultiframe:false}) on a lazy clean dict is eager-identical", () => {
        // encapsulated single frame split into multiple fragments WITH a
        // BOT: both cores read it as one merged frame, so
        // fragmentMultiframe:false re-encodes it as ONE fragment - bytes
        // the source file does not contain.
        const neutralized = charsetNeutralizedCopy(
            readFixture(FRAGMENTED_BOT_PATH)
        );

        const lazyDict = readLazy(neutralized.slice(0));
        expect(lazyDict._lazyWriteContext.charsetPassthroughSafe).toBe(true);
        const lazyOut = new Uint8Array(
            lazyDict.write({ fragmentMultiframe: false })
        );
        const eagerOut = new Uint8Array(
            readEager(neutralized.slice(0)).write({ fragmentMultiframe: false })
        );
        expect(Buffer.from(lazyOut).equals(Buffer.from(eagerOut))).toBe(true);

        // the option had an effect: the default (passthrough) write keeps
        // the source fragmentation and therefore different bytes
        const defaultOut = new Uint8Array(
            readLazy(neutralized.slice(0)).write()
        );
        expect(Buffer.from(defaultOut).equals(Buffer.from(lazyOut))).toBe(
            false
        );
    });

    it("explicitly passing the fragmentMultiframe DEFAULT (true) keeps passthrough", () => {
        const neutralized = charsetNeutralizedCopy(
            readFixture(FRAGMENTED_BOT_PATH)
        );
        const out = new Uint8Array(
            readLazy(neutralized.slice(0)).write({ fragmentMultiframe: true })
        );
        const passthroughOut = new Uint8Array(
            readLazy(neutralized.slice(0)).write()
        );
        expect(Buffer.from(out).equals(Buffer.from(passthroughOut))).toBe(true);
    });

    it("allowInvalidVRLength:false (the validation-only default) does NOT disable passthrough", () => {
        const arrayBuffer = readFixture(CINE_PATH);
        const out = new Uint8Array(
            readLazy(arrayBuffer.slice(0)).write({
                allowInvalidVRLength: false
            })
        );
        // byte-faithful passthrough output, identical to the source file
        expect(
            Buffer.from(out).equals(Buffer.from(new Uint8Array(arrayBuffer)))
        ).toBe(true);
    });
});

describe("writer hardening 3: no allocation amplification across zero-copy windows", () => {
    it("20 x (100-byte write + 1MB window) stays near the re-encoded byte count", () => {
        const stream = new WriteBufferStream(4096, true);
        const windowSource = new Uint8Array(1024 * 1024);
        for (let i = 0; i < windowSource.length; i++) {
            windowSource[i] = (i * 7) & 0xff;
        }

        const iterations = 20;
        const smallSize = 100;
        let reencodedBytes = 0;
        for (let i = 0; i < iterations; i++) {
            stream.writeRawBytes(new Uint8Array(smallSize).fill(i + 1));
            reencodedBytes += smallSize;
            // >= 64KB at the stream end: appended as a zero-copy window
            stream.writeRawBytes(windowSource);
        }

        const info = stream.getBufferMemoryInfo();
        // window bytes are referenced, never copied into writable chunks
        expect(info.zeroCopyWindowBytes).toBe(iterations * windowSource.length);
        expect(stream.view.buffers).toContain(windowSource.buffer);
        // the regression: this used to be ~199MB (each 100-byte write
        // allocated a chunk geometric in the WINDOW-inflated byteLength and
        // truncateTo stranded its tail)
        expect(info.writableAllocated).toBeLessThan(
            3 * reencodedBytes + 64 * 1024
        );

        // the interleaved logical stream reads back correctly
        const all = new Uint8Array(stream.view.slice(0, stream.size));
        expect(all.length).toBe(iterations * (smallSize + windowSource.length));
        for (let i = 0; i < iterations; i++) {
            const base = i * (smallSize + windowSource.length);
            for (let j = 0; j < smallSize; j++) {
                if (all[base + j] !== i + 1) {
                    throw new Error(
                        `small segment ${i} corrupt at +${j}: ${all[base + j]}`
                    );
                }
            }
            for (let j = 0; j < windowSource.length; j++) {
                if (all[base + smallSize + j] !== windowSource[j]) {
                    throw new Error(
                        `window segment ${i} corrupt at +${j}: ${
                            all[base + smallSize + j]
                        }`
                    );
                }
            }
        }
    });

    it("writes and backpatches into reused spare capacity stay correct across windows", () => {
        const stream = new WriteBufferStream(256, true);
        stream.writeAsciiString("HEAD");
        const headPatchOffset = stream.offset;
        stream.writeUint32(0); // backpatched below

        const window = new Uint8Array(80 * 1024);
        for (let i = 0; i < window.length; i++) {
            window[i] = (i * 3) & 0xff;
        }
        stream.writeRawBytes(window); // window 1 truncates the head chunk

        // continues into the head chunk's spare tail
        const midPatchOffset = stream.offset;
        stream.writeUint32(0); // backpatched below
        stream.writeAsciiString("MID");

        stream.writeRawBytes(window); // window 2 truncates the spare chunk
        stream.writeAsciiString("TAIL"); // continues into the next spare

        stream.writeUint32At(headPatchOffset, 0x12345678);
        stream.writeUint32At(midPatchOffset, 0x9abcdef0);

        const result = new Uint8Array(stream.getBuffer());
        const view = new DataView(result.buffer);
        let cursor = 0;
        expect(String.fromCharCode(...result.subarray(0, 4))).toBe("HEAD");
        cursor += 4;
        expect(view.getUint32(cursor, true)).toBe(0x12345678);
        cursor += 4;
        expect(
            Buffer.from(result.subarray(cursor, cursor + window.length)).equals(
                Buffer.from(window)
            )
        ).toBe(true);
        cursor += window.length;
        expect(view.getUint32(cursor, true)).toBe(0x9abcdef0);
        cursor += 4;
        expect(
            String.fromCharCode(...result.subarray(cursor, cursor + 3))
        ).toBe("MID");
        cursor += 3;
        expect(
            Buffer.from(result.subarray(cursor, cursor + window.length)).equals(
                Buffer.from(window)
            )
        ).toBe(true);
        cursor += window.length;
        expect(String.fromCharCode(...result.subarray(cursor))).toBe("TAIL");
        // both small segments fit in the FIRST chunk's spare capacity: no
        // further writable allocation happened
        expect(stream.getBufferMemoryInfo().writableAllocated).toBe(256);
    });
});

describe("writer hardening 4: huge bigint values route through the measured Big16 path", () => {
    it("an LT value of 10n ** 70000n writes and re-parses with all 70001 digits", () => {
        // 10n ** 70000n, spelled without `**` (the babel test transform
        // lowers `**` to Math.pow, which rejects bigints)
        const bigValue = BigInt("1" + "0".repeat(70000));
        const expected = String(bigValue);
        expect(expected.length).toBe(70001);

        const dicomDict = new DicomDict({});
        dicomDict.upsertTag("00204000", "LT", [bigValue]);
        const out = dicomDict.write();

        for (const core of ["eager", "lazy"]) {
            const reread = DicomMessage.readFile(out.slice(0), { core });
            const value = String(reread.dict["00204000"].Value[0]);
            // the odd 70001-byte value is space-padded on disk; the reader
            // may or may not strip the single pad byte
            expect(value.trim()).toBe(expected);
        }
    });

    it("a small bigint LT value keeps the fast backpatch path and round-trips", () => {
        const dicomDict = new DicomDict({});
        dicomDict.upsertTag("00204000", "LT", [123n]);
        const reread = readEager(dicomDict.write());
        expect(String(reread.dict["00204000"].Value[0]).trim()).toBe("123");
    });
});
