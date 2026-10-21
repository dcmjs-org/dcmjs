import { encodeBase64, base64ToArrayBuffer } from "../src/utilities/base64.js";

// The browser path (no Buffer) and the Node path must give the same result.
describe.each([
    ["with Buffer", false],
    ["without Buffer (browser)", true]
])("base64 %s", (_, hideBuffer) => {
    const saved = global.Buffer;
    beforeAll(() => {
        if (hideBuffer) {
            global.Buffer = undefined;
        }
    });
    afterAll(() => {
        global.Buffer = saved;
    });

    test("encodes a view of a larger buffer and decodes it exactly", () => {
        const backing = new Uint8Array([
            0xff, 0x64, 0x63, 0x6d, 0x6a, 0x73, 0x21
        ]);
        const view = backing.subarray(1);
        const encoded = encodeBase64(view);
        expect(encoded).toBe("ZGNtanMh");

        const decoded = base64ToArrayBuffer(encoded);
        expect(decoded).toBeInstanceOf(ArrayBuffer);
        expect(Array.from(new Uint8Array(decoded))).toEqual(Array.from(view));
    });
});
