import SplitDataView from "../src/SplitDataView.js";
import { ReadBufferStream } from "../src/BufferStream.js";
import dcmjs from "../src/index.js";

const { DicomMessage } = dcmjs.data;

// A value length read from the file must never size an allocation on its own.
// https://github.com/dcmjs-org/dcmjs/security/advisories/GHSA-xwvm-687g-rm36

const u16le = v => [v & 0xff, (v >>> 8) & 0xff];
const u32le = v => [
    v & 0xff,
    (v >>> 8) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 24) & 0xff
];
const ascii = s => Array.from(s, c => c.charCodeAt(0));

/** Explicit little endian file whose last element declares `declaredLength`
 * bytes of pixel data while supplying only `pixelData`. */
function buildFile(vr, declaredLength, pixelData = []) {
    const out = new Array(128).fill(0).concat(ascii("DICM"));
    const transferSyntax = ascii("1.2.840.10008.1.2.1\0");
    const metaGroup = [
        ...u16le(0x0002),
        ...u16le(0x0010),
        ...ascii("UI"),
        ...u16le(transferSyntax.length),
        ...transferSyntax
    ];
    out.push(
        ...u16le(0x0002),
        ...u16le(0x0000),
        ...ascii("UL"),
        ...u16le(4),
        ...u32le(metaGroup.length),
        ...metaGroup
    );
    out.push(
        ...u16le(0x7fe0),
        ...u16le(0x0010),
        ...ascii(vr),
        0,
        0,
        ...u32le(declaredLength),
        ...pixelData
    );
    return Uint8Array.from(out).buffer;
}

/** Encapsulated (undefined length) pixel data whose single fragment declares
 * `declaredLength` bytes but supplies only `fragment`. */
function buildEncapsulatedFile(declaredLength, fragment = []) {
    const out = new Array(128).fill(0).concat(ascii("DICM"));
    const transferSyntax = ascii("1.2.840.10008.1.2.4.50\0");
    const metaGroup = [
        ...u16le(0x0002),
        ...u16le(0x0010),
        ...ascii("UI"),
        ...u16le(transferSyntax.length),
        ...transferSyntax
    ];
    out.push(
        ...u16le(0x0002),
        ...u16le(0x0000),
        ...ascii("UL"),
        ...u16le(4),
        ...u32le(metaGroup.length),
        ...metaGroup
    );
    out.push(
        ...u16le(0x7fe0),
        ...u16le(0x0010),
        ...ascii("OB"),
        0,
        0,
        ...u32le(0xffffffff), // undefined length
        ...u16le(0xfffe), // item tag, empty basic offset table
        ...u16le(0xe000),
        ...u32le(0),
        ...u16le(0xfffe), // item tag of the only fragment
        ...u16le(0xe000),
        ...u32le(declaredLength),
        ...fragment
    );
    return Uint8Array.from(out).buffer;
}

const pixelDataOf = dataset => dataset.dict["7FE00010"].Value[0];

describe("declared value lengths do not size allocations (GHSA-xwvm-687g-rm36)", () => {
    describe("SplitDataView.slice", () => {
        it("clamps an end past the held data instead of allocating it", () => {
            const view = new SplitDataView();
            view.addBuffer(Uint8Array.from([1, 2, 3, 4]).buffer);

            const sliced = view.slice(0, 0x10000000);

            expect(sliced.byteLength).toBe(4);
            expect([...new Uint8Array(sliced)]).toEqual([1, 2, 3, 4]);
        });

        it("returns empty when the start is at or past the held data", () => {
            const view = new SplitDataView();
            view.addBuffer(Uint8Array.from([1, 2, 3, 4]).buffer);

            expect(view.slice(4, 0x10000000).byteLength).toBe(0);
        });

        it("still spans multiple buffers within the held data", () => {
            const view = new SplitDataView();
            view.addBuffer(Uint8Array.from([1, 2]).buffer);
            view.addBuffer(Uint8Array.from([3, 4]).buffer);

            expect([...new Uint8Array(view.slice(1, 4))]).toEqual([2, 3, 4]);
        });
    });

    describe("BinaryRepresentation.readBytes", () => {
        it.each(["OB", "OW", "OD", "OF", "UN"])(
            "%s reads only the bytes present",
            vr => {
                const dataset = DicomMessage.readFile(
                    buildFile(vr, 0x10000000, [1, 2, 3, 4, 5, 6, 7, 8])
                );

                expect(pixelDataOf(dataset).byteLength).toBe(8);
            }
        );

        it("bounds a length of 0xfffffffc", () => {
            const dataset = DicomMessage.readFile(
                buildFile("OB", 0xfffffffc, [1, 2])
            );

            expect(pixelDataOf(dataset).byteLength).toBe(2);
        });

        it("bounds a declared length with no value bytes at all", () => {
            const dataset = DicomMessage.readFile(buildFile("OB", 0x10000000));

            expect(pixelDataOf(dataset).byteLength).toBe(0);
        });

        it("reads a correctly declared length unchanged", () => {
            const dataset = DicomMessage.readFile(
                buildFile("OB", 8, [1, 2, 3, 4, 5, 6, 7, 8])
            );

            expect([...new Uint8Array(pixelDataOf(dataset))]).toEqual([
                1, 2, 3, 4, 5, 6, 7, 8
            ]);
        });
    });

    describe("encapsulated fragments", () => {
        it("bounds a fragment item length past the end of the file", () => {
            const dataset = DicomMessage.readFile(
                buildEncapsulatedFile(0x10000000, [1, 2, 3, 4])
            );

            const frames = dataset.dict["7FE00010"].Value;
            const read = frames.reduce(
                (total, frame) => total + frame.byteLength,
                0
            );
            expect(read).toBeLessThanOrEqual(4);
        });
    });

    describe("allocation measured end to end", () => {
        it("does not allocate the declared 256 MiB for a 188 byte file", () => {
            const file = buildFile("OB", 0x10000000);
            expect(file.byteLength).toBeLessThan(256);

            // Warm up so the measurement covers only the parse under test.
            DicomMessage.readFile(buildFile("OB", 8, [1, 2, 3, 4, 5, 6, 7, 8]));
            const before = process.memoryUsage().arrayBuffers;
            DicomMessage.readFile(file);
            const grewBy = process.memoryUsage().arrayBuffers - before;

            // 256 MiB would be the unbounded allocation; allow generous
            // headroom for whatever else the parse legitimately holds.
            expect(grewBy).toBeLessThan(16 * 1024 * 1024);
        });
    });
});

describe("ReadBufferStream bounds", () => {
    it("slices no more than the stream holds", () => {
        const stream = new ReadBufferStream(
            Uint8Array.from([1, 2, 3, 4]).buffer,
            true
        );

        expect(stream.getBuffer(0, 0x10000000).byteLength).toBe(4);
    });
});
