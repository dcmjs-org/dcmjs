import log from "../../log.js";

const MM_UNIT = {
    CodeValue: "mm",
    CodingSchemeDesignator: "UCUM",
    CodingSchemeVersion: "1.4",
    CodeMeaning: "millimeter"
};

const MM2_UNIT = {
    CodeValue: "mm2",
    CodingSchemeDesignator: "UCUM",
    CodingSchemeVersion: "1.4",
    CodeMeaning: "SquareMilliMeter"
};

const NO_UNIT = {
    CodeValue: "1",
    CodingSchemeDesignator: "UCUM",
    CodingSchemeVersion: "1.4",
    CodeMeaning: "px"
};

const NO2_UNIT = NO_UNIT;

const measurementMap = {
    px: NO_UNIT,
    mm: MM_UNIT,
    mm2: MM2_UNIT,
    "mm\xB2": MM2_UNIT,
    "px\xB2": NO2_UNIT
};

/** Converts the given unit into the
 * specified coding values.
 * Has .measurementMap on the function specifying global units for measurements.
 */
const unit2CodingValue = units => {
    if (!units) return NO_UNIT;
    const space = units.indexOf(" ");
    const baseUnit = space === -1 ? units : units.substring(0, space);
    const codingUnit = measurementMap[units] || measurementMap[baseUnit];
    if (!codingUnit) {
        log.error("Unspecified units", units);
        return MM_UNIT;
    }
    return codingUnit;
};

unit2CodingValue.measurementMap = measurementMap;

export default unit2CodingValue;
