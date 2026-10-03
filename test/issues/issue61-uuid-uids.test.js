/**
 * Issue-derived regression tests — DicomMetaDictionary.uid().
 *
 * #61 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/61
 *   Symptom: PS3.5 Annex B.2 requires UIDs with root "2.25" to be the
 *   decimal encoding of a 128-bit UUID (ITU-T X.667). The generator in
 *   src/DicomMetaDictionary.js (static uid()) instead concatenates 39
 *   random decimal digits ("2.25." + [1-9] + 38 random digits), which is
 *   NOT UUID-derived: the integer part ranges up to 10^39 - 1 while a
 *   128-bit UUID caps at 2^128 - 1 (≈ 3.4e38), so most generated values
 *   cannot correspond to any UUID at all, and none carry the RFC 4122
 *   version/variant bits.
 *
 * The generator now derives the integer part from a freshly generated
 * RFC 4122 version 4 UUID, so both the syntactic properties and the
 * UUID-derivation requirement are pinned here.
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

    it("uid() integer part is the decimal encoding of a version 4, RFC 4122-variant 128-bit UUID", () => {
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
