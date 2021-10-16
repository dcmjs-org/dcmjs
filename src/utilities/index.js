import TID1500 from "./TID1500/index.js";
import TID300 from "./TID300/index.js";
import message from "./Message.js";

const unitsCodedTermMap = {
    hu: {
        CodeValue: "hnsf'U",
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeMeaning: "Hounsfield Unit"
    },
    suv: {
        CodeValue: "{SUVbw}g/ml",
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeMeaning: "Standardized Uptake Value body weight"
    },
    mm: {
        CodeValue: "mm",
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeMeaning: "MilliMeter"
    },
    mm2: {
        CodeValue: "mm2",
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeMeaning: "SquareMilliMeter"
    },
    "1": {
        CodeValue: "1",
        CodingSchemeDesignator: "UCUM",
        CodingSchemeVersion: "1.4",
        CodeMeaning: "no units"
    }
};

const quantificationCodedTermMap = {
    Perimeter: {
        CodeValue: "131191004",
        CodingSchemeDesignator: "SCT",
        CodeMeaning: "Perimeter"
    },
    Area: {
        CodeValue: "2798000",
        CodingSchemeDesignator: "SCT",
        CodeMeaning: "Area"
    },
    Volume: {
        CodeValue: "1185650",
        CodingSchemeDesignator: "SCT",
        CodeMeaning: "Volume"
    },
    Min: {
        CodeValue: "R-404FB",
        CodingSchemeDesignator: "SRT",
        CodeMeaning: "Min"
    },
    Max: {
        CodeValue: "G-A437",
        CodingSchemeDesignator: "SRT",
        CodeMeaning: "Max"
    },
    StdDev: {
        CodeValue: "R-10047",
        CodingSchemeDesignator: "SRT",
        CodeMeaning: "Standard Deviation"
    },
    Mean: {
        CodeValue: "R-00317",
        CodingSchemeDesignator: "SRT",
        CodeMeaning: "Mean"
    }
};

const utilities = {
    TID1500,
    TID300,
    message,
    unitsCodedTermMap,
    quantificationCodedTermMap
};

export default utilities;
