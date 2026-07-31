import unit2CodingValue from "../src/utilities/TID300/unit2CodingValue.js";

describe("unit2CodingValue", () => {
    it("maps millimetres to the UCUM code", () => {
        expect(unit2CodingValue("mm")).toEqual(
            expect.objectContaining({
                CodeValue: "mm",
                CodingSchemeDesignator: "UCUM"
            })
        );
    });

    // Centimetres are the normal case for ultrasound images calibrated
    // through SequenceOfUltrasoundRegions, where PhysicalUnitsXDirection = 3
    // means cm. Without an entry these fell through to the arbitrary-unit
    // branch and were stored as [arb'U]{cm} / "arbitrary cm".
    it("maps centimetres to the UCUM code instead of an arbitrary unit", () => {
        const coding = unit2CodingValue("cm");

        expect(coding).toEqual(
            expect.objectContaining({
                CodeValue: "cm",
                CodingSchemeDesignator: "UCUM"
            })
        );
        expect(coding.CodeValue).not.toMatch(/arb/);
    });

    // Cornerstone3D labels calibrated ultrasound measurements as
    // "cm US Region"; unit2CodingValue falls back to the part before the
    // first space, which must resolve to the plain centimetre code.
    it("resolves a calibration-suffixed unit to its base unit", () => {
        expect(unit2CodingValue("cm US Region")).toEqual(
            expect.objectContaining({ CodeValue: "cm" })
        );
    });

    it("still falls back to an arbitrary unit for something unknown", () => {
        expect(unit2CodingValue("bananas").CodeValue).toBe("[arb'U]{bananas}");
    });
});
