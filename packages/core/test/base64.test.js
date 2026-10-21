import { encodeBase64, base64ToArrayBuffer } from "../src/utilities/base64.js";

const BACKING = new Uint8Array([0xff, 0x64, 0x63, 0x6d, 0x6a, 0x73, 0x21]);
const VIEW = BACKING.subarray(1); // "dcmjs!"

// Each runtime path must give the same result: the native Uint8Array
// methods (stand-ins here, because Node 24 has none), Node's Buffer, and
// the browser btoa/atob path.
describe.each([
    ["native Uint8Array methods", "native"],
    ["Buffer", "buffer"],
    ["btoa/atob (browser)", "browser"]
])("base64 with %s", (_, path) => {
    const savedBuffer = global.Buffer;
    beforeAll(() => {
        if (path === "native") {
            Uint8Array.prototype.toBase64 = function () {
                return savedBuffer
                    .from(this.buffer, this.byteOffset, this.byteLength)
                    .toString("base64");
            };
            Uint8Array.fromBase64 = b64 =>
                new Uint8Array(savedBuffer.from(b64, "base64"));
        }
        if (path !== "buffer") {
            global.Buffer = undefined;
        }
    });
    afterAll(() => {
        delete Uint8Array.prototype.toBase64;
        delete Uint8Array.fromBase64;
        global.Buffer = savedBuffer;
    });

    test("encodes a view of a larger buffer and decodes it exactly", () => {
        const encoded = encodeBase64(VIEW);
        expect(encoded).toBe("ZGNtanMh");

        const decoded = base64ToArrayBuffer(encoded);
        expect(decoded).toBeInstanceOf(ArrayBuffer);
        expect(Array.from(new Uint8Array(decoded))).toEqual(Array.from(VIEW));
    });
});
