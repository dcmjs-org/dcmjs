import { DicomMetaDictionary } from "../src/DicomMetaDictionary";

describe("DicomMetaDictionary", () => {
    describe("static methods", () => {
        describe("unpunctuateTag", () => {
            it("returns the unpunctuated tag String", () => {
                const originalTag = "(0000,0003)";
                const unpunctuatedTag = "00000003";

                expect(DicomMetaDictionary.unpunctuateTag(originalTag)).toMatch(
                    unpunctuatedTag
                );
            });

            it("returns non-punctuated strings unchanged.", () => {
                const originalTag = "PixelData";

                expect(DicomMetaDictionary.unpunctuateTag(originalTag)).toBe(
                    originalTag
                );
            });
        });

        describe("punctuateTag", () => {
            it("returns private dictionary keys with commas unchanged.", () => {
                const privateTag = '(0009,"ACUSON",00)';

                expect(DicomMetaDictionary.punctuateTag(privateTag)).toBe(
                    privateTag
                );
            });
        });

        describe("normalizeTag", () => {
            it("returns clean uppercase tags for supported tag formats.", () => {
                const expectedTag = "7FE00010";
                const tagFormats = [
                    "7FE00010",
                    "7fe00010",
                    "(7FE0,0010)",
                    "(7fe0,0010)",
                    "7FE0,0010"
                ];

                tagFormats.forEach(tag => {
                    expect(DicomMetaDictionary.normalizeTag(tag)).toBe(
                        expectedTag
                    );
                });
            });

            it("returns undefined for invalid tag strings.", () => {
                const invalidTag = "PixelData";

                expect(DicomMetaDictionary.normalizeTag(invalidTag)).toBe(
                    undefined
                );
            });
        });

        describe("normalizeTagOption", () => {
            it("returns normalized tags for valid option values.", () => {
                const originalTag = "(7fe0,0010)";
                const expectedTag = "7FE00010";

                expect(
                    DicomMetaDictionary.normalizeTagOption(originalTag)
                ).toBe(expectedTag);
            });

            it("throws for invalid option values.", () => {
                const invalidTag = "PixelData";

                expect(() =>
                    DicomMetaDictionary.normalizeTagOption(
                        invalidTag,
                        "untilTag"
                    )
                ).toThrow("Invalid untilTag: PixelData");
            });
        });

        describe("parseIntFromTag", () => {
            it("returns the correct Integer of a simple Integer", () => {
                const originalTag = "(0000,0003)";
                const integerValue = 3;

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(
                    integerValue
                );
            });

            it("returns the correct Integer of a simple hexadecimal String", () => {
                const originalTag = "(0000,000F)";
                const integerValue = 15;

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(
                    integerValue
                );
            });

            it("returns the correct Integer of a complex hexadecimal String", () => {
                const originalTag = "(000F,0000)";
                const integerValue = 983040;

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(
                    integerValue
                );
            });

            it("returns NaN if String can not be parsed", () => {
                const originalTag = "()";

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(
                    NaN
                );
            });
        });

        describe("tagAsIntegerFromName", () => {
            it("returns undefined if name has no item in dictionary", () => {
                const tagName = "dummy";

                expect(DicomMetaDictionary.tagAsIntegerFromName(tagName)).toBe(
                    undefined
                );
            });

            describe("tagAsIntegerFromName", () => {
                it("returns the tag as integer value", () => {
                    const tagName = "AffectedSOPClassUID";

                    expect(
                        DicomMetaDictionary.tagAsIntegerFromName(tagName)
                    ).toBe(2);
                });
            });
        });
    });
});
