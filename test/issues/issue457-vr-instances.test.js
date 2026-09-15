/**
 * Upstream issue: https://github.com/dcmjs-org/dcmjs/issues/457
 *
 * Symptom: the VRinstances registry behind
 * ValueRepresentation.createByTypeString was missing the OL, OV, SV and UV
 * value representations, so every lookup for those types logged an
 * "Invalid vr type ... - using UN" validation error and fell back to the UN
 * writer — noisy per-element log spam for files that legitimately carry
 * those 2015+ VRs.
 *
 * Triage category: C (contract assertion). How 1.0 deliberately differs
 * from the upstream report: UV got a real Unsigned64BitVeryLong instance
 * (added for the Supplement 225 video arc), while OL/OV/SV intentionally
 * remain UN fallbacks — safe byte-preserving reads/writes — with the log
 * demoted from error to warn and emitted at most once per unknown type;
 * this file pins that split contract rather than requiring four dedicated
 * implementations.
 */
import { ValueRepresentation } from "../../src/ValueRepresentation.js";
import { validationLog } from "../../src/log.js";

validationLog.setLevel(5);

describe("issue #457 — VR registry coverage for OL, OV, SV, UV", () => {
    it("createByTypeString('UV') returns a real UV instance", () => {
        const vr = ValueRepresentation.createByTypeString("UV");
        expect(vr).toBeDefined();
        expect(vr.type).toBe("UV");
        expect(vr.maxLength).toBe(8); // 64-bit very long
        expect(vr.isBinary()).toBe(true);
    });

    it("OL/OV/SV fall back to a usable UN instance without throwing", () => {
        for (const type of ["OL", "OV", "SV"]) {
            let vr;
            expect(() => {
                vr = ValueRepresentation.createByTypeString(type);
            }).not.toThrow();
            expect(vr).toBeDefined();
            expect(vr.type).toBe("UN"); // current contract: UN fallback
            expect(typeof vr.readBytes).toBe("function");
            expect(typeof vr.writeBytes).toBe("function");
        }
    });

    it("fallback lookups are stable (same shared instance every call)", () => {
        const first = ValueRepresentation.createByTypeString("OL");
        const second = ValueRepresentation.createByTypeString("OL");
        expect(second).toBe(first);
        expect(ValueRepresentation.createByTypeString("SV")).toBe(first);
    });

    it("fallback logs at warn severity, not error (no validation-error spam)", () => {
        // Uses a type no other test in this file has looked up: the fallback
        // now warns at most once per type, so a previously-seen type would
        // (correctly) stay silent here.
        const warns = [];
        const errors = [];
        const origWarn = validationLog.warn;
        const origError = validationLog.error;
        validationLog.warn = (...args) => warns.push(args);
        validationLog.error = (...args) => errors.push(args);
        try {
            ValueRepresentation.createByTypeString("QX");
        } finally {
            validationLog.warn = origWarn;
            validationLog.error = origError;
        }
        expect(errors).toHaveLength(0);
        expect(warns.length).toBeGreaterThanOrEqual(1);
    });

    // Fixed in this arc: createByTypeString tracks unknown types in a
    // module-level seen-set and warns only on the first lookup of each type,
    // with identical UN-fallback semantics — no more per-element log spam.
    it("#457: OL/OV/SV fallback warns at most once per type across repeated lookups", () => {
        const warns = [];
        const origWarn = validationLog.warn;
        validationLog.warn = (...args) => warns.push(args);
        try {
            ValueRepresentation.createByTypeString("OV");
            ValueRepresentation.createByTypeString("OV");
            ValueRepresentation.createByTypeString("OV");
        } finally {
            validationLog.warn = origWarn;
        }
        expect(warns.length).toBeLessThanOrEqual(1);
    });
});
