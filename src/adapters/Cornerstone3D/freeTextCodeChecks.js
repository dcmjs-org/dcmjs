import CodingScheme from "./CodingScheme";

/**
 * Checks if the given code value is the free text annotation code value
 * @param {string} codeValue - The code value to check
 * @returns {boolean} True if the code value matches the free text annotation code (CS3DTEXT)
 */
const isFreeTextCodeValue = codeValue => {
    return codeValue === CodingScheme.FREE_TEXT_CODE_VALUE;
};

/**
 * Checks if the given code value is the legacy free text code value
 *
 * NOTE:
 * This is kept only for backward compatibility when reading old DICOM SRs.
 * New SRs must NOT use this legacy code value.
 *
 * @param {string} codeValue - The code value to check
 * @returns {boolean} True if the code value matches the legacy free text code (CORNERSTONEFREETEXT)
 */
const isLegacyFreeTextCodeValue = codeValue => {
    return codeValue === CodingScheme.CORNERSTONEFREETEXT;
};

export { isFreeTextCodeValue, isLegacyFreeTextCodeValue };
