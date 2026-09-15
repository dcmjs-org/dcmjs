/**
 * Issue-derived regression tests — DicomMetaDictionary.uid().
 *
 * #61 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/61
 *   Symptom (historical): PS3.5 Annex B.2 requires UIDs with root "2.25"
 *   to be the decimal encoding of a 128-bit UUID (ITU-T X.667). The
 *   generator in src/DicomMetaDictionary.js (static uid()) used to
 *   concatenate 39 random decimal digits, which was NOT UUID-derived.
 *   Fixed in this arc: uid() now generates an RFC 4122 version 4 UUID
 *   and emits "2.25." + its unsigned 128-bit decimal value.
 */
import dcmjs from "../../src/index.js";

const { DicomMetaDictionary } = dcmjs.data;

const SAMPLES = 50;

describe("issue #61 — 2.25 UIDs must be UUID-derived (PS3.5 B.2)", () => {
    it("generates syntactically valid 2.25.<integer> UIDs (≤64 chars, digits only, no leading zero)", () => {
        for (let i = 0; i < SAMPLES; i++) {
            const uid = DicomMetaDictionary.uid();
            expect(uid.startsWith("2.25.")).toBe(true);
            expect(uid.length).toBeLessThanOrEqual(64);
            const integerPart = uid.slice("2.25.".length);
            expect(integerPart).toMatch(/^[0-9]+$/);
            // A UID component must not have a leading zero (PS3.5 9.1)
            expect(integerPart[0]).not.toBe("0");
        }
    });

    // Fixed in this arc: static uid() now generates a random RFC 4122
    // version 4 UUID (globalThis.crypto.getRandomValues with a
    // Math.random fallback) and emits "2.25." + the decimal encoding of
    // its unsigned 128-bit value per PS3.5 B.2 / ITU-T X.667, instead of
    // concatenating 39 random decimal digits.
    it("#61: uid() integer part is the decimal encoding of a 128-bit v4 UUID", () => {
        const MAX_UUID = 1n << 128n;
        for (let i = 0; i < SAMPLES; i++) {
            const uid = DicomMetaDictionary.uid();
            const value = BigInt(uid.slice("2.25.".length));
            // Must fit in 128 bits to be UUID-derived at all.
            expect(value < MAX_UUID).toBe(true);
            // A freshly-generated UUID must be version 4 (random) with the
            // RFC 4122 variant: bits 76-79 = 0100, bits 62-63 = 10.
            const version = (value >> 76n) & 0xfn;
            const variant = (value >> 62n) & 0x3n;
            expect(version).toBe(4n);
            expect(variant).toBe(2n);
        }
    });
});
