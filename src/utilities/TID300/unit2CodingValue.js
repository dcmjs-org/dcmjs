import log from "../../log.js";

const knownUnits = [
    // Standard UCUM units.
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "mm",
        CodeMeaning: "mm"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "mm2",
        CodeMeaning: "mm2"
    },
    // Units defined in https://dicom.nema.org/medical/dicom/current/output/chtml/part16/sect_CID_83.html
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "[hnsf'U]",
        CodeMeaning: "Hounsfield unit"
    },
    // Units defined in https://dicom.nema.org/medical/dicom/current/output/chtml/part16/sect_CID_84.html
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "{counts}",
        CodeMeaning: "Counts"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "{counts}/s",
        CodeMeaning: "Counts per second"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "{propcounts}",
        CodeMeaning: "Proportional to counts"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "{propcounts}/s",
        CodeMeaning: "Proportional to counts per second"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "cm2",
        CodeMeaning: "cm2"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "cm2/ml",
        CodeMeaning: "cm2/ml"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "%",
        CodeMeaning: "Percent"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "Bq/ml",
        CodeMeaning: "Becquerels/milliliter"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "mg/min/ml",
        CodeMeaning: "Milligrams/minute/milliliter"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "umol/min/ml",
        CodeMeaning: "Micromole/minute/milliliter"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "ml/min/g",
        CodeMeaning: "Milliliter/minute/gram"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "ml/g",
        CodeMeaning: "Milliliter/gram"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "/cm",
        CodeMeaning: "/Centimeter"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "umol/ml",
        CodeMeaning: "Micromole/milliliter"
    },
    // Units defined in https://dicom.nema.org/medical/dicom/current/output/chtml/part16/sect_CID_85.html
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "g/ml{SUVbw}",
        CodeMeaning: "Standardized Uptake Value body weight"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "g/ml{SUVlbm}",
        CodeMeaning: "Standardized Uptake Value lean body mass (James)"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "g/ml{SUVlbm(James128)}",
        CodeMeaning:
            "Standardized Uptake Value lean body mass (James 128 multiplier)"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "g/ml{SUVlbm(Janma)}",
        CodeMeaning: "Standardized Uptake Value lean body mass (Janma)"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "cm2/ml{SUVbsa}",
        CodeMeaning: "Standardized Uptake Value body surface area"
    },
    {
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeValue: "g/ml{SUVibw}",
        CodeMeaning: "Standardized Uptake Value ideal body weight"
    }
];

// Create unitCodeMap from knownUnits for efficient lookup
const unitCodeMap = {};
knownUnits.forEach(unit => {
    unitCodeMap[unit.CodeValue] = unit;
});

const noUnitCodeValues = ["px", "px\xB2"];
const NO_UNIT = {
    CodeValue: "1",
    CodingSchemeDesignator: "UCUM",
    CodingSchemeVersion: "1.4",
    CodeMeaning: "px"
};
noUnitCodeValues.forEach(codeValue => {
    unitCodeMap[codeValue] = NO_UNIT;
});

unitCodeMap["HU"] = {
    CodingSchemeDesignator: "UCUM",
    CodingSchemeVersion: "1.4",
    CodeValue: "[hnsf'U]",
    CodeMeaning: "Hounsfield unit"
};

unitCodeMap["mm\xB2"] = {
    CodingSchemeDesignator: "UCUM",
    CodingSchemeVersion: "1.4",
    CodeValue: "mm2",
    CodeMeaning: "mm2"
};

/** Converts the given unit into the
 * specified coding values.
 * Has .measurementMap on the function specifying global units for measurements.
 */
const unit2CodingValue = units => {
    if (!units) return NO_UNIT;
    const space = units.indexOf(" ");
    const baseUnit = space === -1 ? units : units.substring(0, space);
    const codingUnit = unitCodeMap[units] || unitCodeMap[baseUnit];
    if (!codingUnit) {
        log.error("Unspecified units", units);

        return {
            CodeValue: "[arb'U]",
            CodingSchemeDesignator: "UCUM",
            CodeMeaning: `[arb'U'] ${units}`
        };
    }
    return codingUnit;
};

unit2CodingValue.measurementMap = unitCodeMap;

export default unit2CodingValue;
