/**
 * Issue-derived regression tests — TID300 unit2CodingValue.
 *
 * #505 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/505
 *   Symptom: `unit2CodingValue("cm")` has no map entry for plain "cm"
 *   (the knownUnits list has "mm", "mm2", "cm2", "cm2/ml", "/cm" — but not
 *   "cm"), so centimetre measurements (e.g. ultrasound regions with
 *   PhysicalUnitsXDirection = 3) fall through to the arbitrary-unit branch
 *   and the SR carries CodeValue "[arb'U]{cm}" / CodeMeaning "arbitrary cm"
 *   instead of the regular UCUM code "cm".
 *
 * unit2CodingValue is a pure function (default export of
 * src/utilities/TID300/unit2CodingValue.js); no other suite covers its
 * mapping table directly.
 */
import unit2CodingValue from "../../src/utilities/TID300/unit2CodingValue.js";

describe("issue #505 — unit2CodingValue mapping table", () => {
    it("maps 'mm' to UCUM CodeValue 'mm'", () => {
        const coding = unit2CodingValue("mm");
        expect(coding.CodingSchemeDesignator).toBe("UCUM");
        expect(coding.CodeValue).toBe("mm");
    });

    it("maps 'cm2' to UCUM CodeValue 'cm2'", () => {
        const coding = unit2CodingValue("cm2");
        expect(coding.CodingSchemeDesignator).toBe("UCUM");
        expect(coding.CodeValue).toBe("cm2");
    });

    it("maps 'HU' to the Hounsfield unit UCUM code", () => {
        const coding = unit2CodingValue("HU");
        expect(coding.CodingSchemeDesignator).toBe("UCUM");
        expect(coding.CodeValue).toBe("[hnsf'U]");
    });

    // KNOWN GAP: observed unit2CodingValue("cm") ===
    //   { CodeValue: "[arb'U]{cm}", CodingSchemeDesignator: "UCUM",
    //     CodeMeaning: "arbitrary cm" }
    // (the arbitrary-unit fallback, because "cm" is missing from
    // knownUnits/unitCodeMap); expected the regular UCUM code
    // CodeValue === "cm".
    it.skip("KNOWN GAP #505: 'cm' falls through to [arb'U]{cm} instead of UCUM 'cm'", () => {
        const coding = unit2CodingValue("cm");
        expect(coding.CodingSchemeDesignator).toBe("UCUM");
        expect(coding.CodeValue).toBe("cm");
    });
});
