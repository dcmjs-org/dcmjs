import "../../src/index.js";
import {
    resolveCharsetDecoder,
    Iso2022Decoder
} from "../../src/charset/iso2022.js";

describe("resolveCharsetDecoder", () => {
    test("no values means no decoder (default repertoire)", () => {
        expect(resolveCharsetDecoder(null)).toBeNull();
        expect(resolveCharsetDecoder([])).toBeNull();
    });

    test("single supported charset returns a working decoder", () => {
        const decoder = resolveCharsetDecoder(["ISO_IR 192"]);
        const bytes = new Uint8Array([0xe6, 0xbc, 0xa2]); // 漢 in UTF-8
        expect(decoder.decode(bytes)).toBe("漢");
    });

    test("Latin-1 decodes high bytes", () => {
        const decoder = resolveCharsetDecoder(["ISO_IR 100"]);
        const bytes = new Uint8Array([0xe9]); // é in ISO 8859-1
        expect(decoder.decode(bytes)).toBe("é");
    });

    test("unsupported single charset throws by default", () => {
        expect(() => resolveCharsetDecoder(["nope"])).toThrow(
            /Unsupported character set/
        );
    });

    test("unsupported single charset returns null under ignoreErrors", () => {
        expect(
            resolveCharsetDecoder(["nope"], { ignoreErrors: true })
        ).toBeNull();
    });

    test("ISO 2022 code-extension list returns an Iso2022Decoder", () => {
        const decoder = resolveCharsetDecoder([
            "ISO 2022 IR 13",
            "ISO 2022 IR 87"
        ]);
        expect(decoder).toBeInstanceOf(Iso2022Decoder);
    });

    test("multi-valued non-2022 list throws by default and falls back under ignoreErrors", () => {
        expect(() =>
            resolveCharsetDecoder(["ISO_IR 100", "ISO_IR 144"])
        ).toThrow(/multiple character sets/);
        const fallback = resolveCharsetDecoder(["ISO_IR 100", "ISO_IR 144"], {
            ignoreErrors: true
        });
        const bytes = new Uint8Array([0xe9]);
        expect(fallback.decode(bytes)).toBe("é");
    });
});
