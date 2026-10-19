import dcmjs from "../src/index.js";
import dicomJson from "../src/utilities/dicomJson.js";

const { utilities } = dcmjs;
const { addAccessors } = utilities;

describe("dicomJson", () => {
    describe("pnAddValueAccessors", () => {
        it("recreates json object from string input", () => {
            const value = new String("One\\Two");
            const accessorValue = dicomJson.pnAddValueAccessors(value);

            expect(value).toBe(accessorValue);
            expect(JSON.stringify(value)).toEqual(
                JSON.stringify([{ Alphabetic: "One" }, { Alphabetic: "Two" }])
            );
            expect(String(accessorValue)).toEqual("One\\Two");
        });

        it("recreates dicom string from json object", () => {
            const value = [{ Alphabetic: "One" }, { Alphabetic: "Two" }];
            const accessorValue = dicomJson.pnAddValueAccessors(value);

            expect(value).toBe(accessorValue);
            expect(JSON.stringify(value)).toEqual(
                JSON.stringify([{ Alphabetic: "One" }, { Alphabetic: "Two" }])
            );
            expect(String(accessorValue)).toEqual("One\\Two");
        });
    });

    describe("pnObjectToString", () => {
        it("accepts undefined and empty", () => {
            expect(dicomJson.pnObjectToString(undefined)).toEqual("");
            expect(dicomJson.pnObjectToString(null)).toEqual("");
            expect(dicomJson.pnObjectToString("")).toEqual("");
        });

        it("accepts json PNs", () => {
            expect(dicomJson.pnObjectToString({ Alphabetic: "One" })).toEqual(
                "One"
            );
            expect(dicomJson.pnObjectToString([{ Alphabetic: "One" }])).toEqual(
                "One"
            );
            expect(
                dicomJson.pnObjectToString([
                    {
                        Alphabetic: "One",
                        Ideographic: undefined,
                        Phonetic: undefined
                    }
                ])
            ).toEqual("One");
            expect(
                dicomJson.pnObjectToString([
                    { Alphabetic: "One", Ideographic: "Two", Phonetic: "Three" }
                ])
            ).toEqual("One=Two=Three");
            expect(
                dicomJson.pnObjectToString([
                    { Alphabetic: "One" },
                    { Alphabetic: "Two" }
                ])
            ).toEqual("One\\Two");
        });

        it("accepts strings", () => {
            expect(dicomJson.pnObjectToString("One")).toEqual("One");
            expect(dicomJson.pnObjectToString(String("One"))).toEqual("One");
            expect(dicomJson.pnObjectToString("One=Two\\Three\\Four")).toEqual(
                "One=Two\\Three\\Four"
            );
        });
    });

    describe("pnConvertToJsonObject", () => {
        it("accepts undefined", () => {
            expect(dicomJson.pnConvertToJsonObject(undefined)).toEqual([]);
            expect(dicomJson.pnConvertToJsonObject(undefined, false)).toEqual(
                undefined
            );
        });

        it("accepts a single name string", () => {
            expect(dicomJson.pnConvertToJsonObject("One")).toEqual([
                { Alphabetic: "One" }
            ]);
            expect(dicomJson.pnConvertToJsonObject("One==")).toEqual([
                { Alphabetic: "One" }
            ]);
            expect(dicomJson.pnConvertToJsonObject("One=Two=")).toEqual([
                { Alphabetic: "One", Ideographic: "Two" }
            ]);
            expect(dicomJson.pnConvertToJsonObject("One==Three")).toEqual([
                { Alphabetic: "One", Phonetic: "Three" }
            ]);
            expect(dicomJson.pnConvertToJsonObject("One=Two=Three")).toEqual([
                { Alphabetic: "One", Ideographic: "Two", Phonetic: "Three" }
            ]);
            expect(
                dicomJson.pnConvertToJsonObject("One=Two=Three", false)
            ).toEqual({
                Alphabetic: "One",
                Ideographic: "Two",
                Phonetic: "Three"
            });
            // Discard extraneous or empty values
            expect(
                dicomJson.pnConvertToJsonObject("One=Two=Three\\Four", false)
            ).toEqual({
                Alphabetic: "One",
                Ideographic: "Two",
                Phonetic: "Three"
            });
            expect(dicomJson.pnConvertToJsonObject("\\One=Two=Three")).toEqual([
                {
                    Alphabetic: "One",
                    Ideographic: "Two",
                    Phonetic: "Three"
                }
            ]);
            expect(
                dicomJson.pnConvertToJsonObject("\\One=Two=Three", false)
            ).toEqual({
                Alphabetic: "One",
                Ideographic: "Two",
                Phonetic: "Three"
            });
        });

        it("accepts multiple name string", () => {
            expect(
                dicomJson.pnConvertToJsonObject("One=Two=Three\\Four=Five=Six")
            ).toEqual([
                { Alphabetic: "One", Ideographic: "Two", Phonetic: "Three" },
                { Alphabetic: "Four", Ideographic: "Five", Phonetic: "Six" }
            ]);
        });

        it("accepts objects", () => {
            const jsonObj = {
                Alphabetic: "One",
                Ideographic: "Two",
                Phonetic: "Three"
            };
            expect(dicomJson.pnConvertToJsonObject(jsonObj)).toEqual([jsonObj]);
            expect(dicomJson.pnConvertToJsonObject(jsonObj, false)).toEqual(
                jsonObj
            );
            expect(dicomJson.pnConvertToJsonObject([jsonObj])).toEqual([
                jsonObj
            ]);
            expect(dicomJson.pnConvertToJsonObject([jsonObj], false)).toEqual([
                jsonObj
            ]);
        });
    });
});

describe("addAccessor", () => {
    it("returns the single item, with [0], length and iteration", () => {
        const baseValue = { a: 1, b: 2 };
        const val = addAccessors([baseValue]);
        expect(val).toBe(baseValue);
        expect(val.a).toEqual(1);
        expect(val[0]).toBe(baseValue);
        expect(val.length).toBe(1);
        expect([...val]).toEqual([baseValue]);
        expect(Array.isArray(val)).toBe(false);
        expect(Object.keys(val)).toEqual(["a", "b"]);
    });

    it("leaves other values unchanged, and does not wrap twice", () => {
        const baseValue = { a: 1, b: 2 };
        expect(addAccessors(addAccessors(baseValue))).toBe(baseValue);
        expect(addAccessors("Hello")).toBe("Hello");
        const two = [baseValue, 2];
        expect(addAccessors(two)).toBe(two);
    });
});
