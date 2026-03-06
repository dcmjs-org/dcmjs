// This is a custom coding scheme defined to store some annotations from Cornerstone.
// Note: CodeMeaning is VR type LO, which means we only actually support 64 characters
// here this is fine for most labels, but may be problematic at some point.
// CodeValue must be ≤ 16 characters (SH VR constraint)
const FREE_TEXT_CODE_VALUE = "CS3DTEXT";

// Private coding scheme designator for dcmjs
const CodingSchemeDesignator = "99dcmjs";

// Legacy code value for backward compatibility (deprecated, exceeds SH VR limit)
const CORNERSTONEFREETEXT = "CORNERSTONEFREETEXT";

const CodingScheme = {
    CodingSchemeDesignator,
    codeValues: {
        FREE_TEXT_CODE_VALUE: FREE_TEXT_CODE_VALUE,
        // Legacy support - kept for reading old files
        CORNERSTONEFREETEXT
    }
};

export default CodingScheme;
