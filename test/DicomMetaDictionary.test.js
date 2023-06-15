import { DicomMetaDictionary } from "../src/DicomMetaDictionary";

describe('DicomMetaDictionary', () => {
    describe('static methods', () => {
        describe('unpunctuateTag', () => {
            it('returns the unpunctuated tag String', () => {
                const originalTag = "(0000,0003)";
                const unpunctuatedTag = "00000003";

                expect(DicomMetaDictionary.unpunctuateTag(originalTag)).toMatch(unpunctuatedTag);

            })
        })

        describe('parseIntFromTag', () => {
            it('returns the correct Integer of a simple Integer', () => {
                const originalTag = "(0000,0003)";
                const integerValue = 3;

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(integerValue);

            })

            it('returns the correct Integer of a simple hexadecimal String', () => {
                const originalTag = "(0000,000F)";
                const integerValue = 15;

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(integerValue);

            })

            it('returns the correct Integer of a complex hexadecimal String', () => {
                const originalTag = "(000F,0000)";
                const integerValue = 983040;

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(integerValue);

            })

            it('returns NaN if String can not be parsed', () => {
                const originalTag = "()";

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(NaN);

            })
        })

        describe('tagAsIntegerFromName', () => {
            it('returns undefined if name has no item in dictionary', () => {
                const tagName = "dummy";

                expect(DicomMetaDictionary.tagAsIntegerFromName(tagName)).toBe(undefined);

            })

            describe('tagAsIntegerFromName', () => {
                it('returns the tag as integer value', () => {
                    const tagName = "AffectedSOPClassUID";

                    expect(DicomMetaDictionary.tagAsIntegerFromName(tagName)).toBe(2);

                })
            })
        })
    })
})