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
    it("testAddAccessor", () => {
        const baseValue = { a: 1, b: 2 };
        const arrValue = [baseValue];
        const val = addAccessors(arrValue);
        expect(val.a).toEqual(1);
        baseValue.a = 3;
        expect(val.a).toEqual(3);
        val.b = 4;
        expect(baseValue.b).toEqual(4);

        // Check that we can iterate as an array
        const forArr = [];
        val.forEach(item => forArr.push(item));
        expect(forArr.length).toEqual(1);
        expect(forArr[0]).toEqual(baseValue);
    });

    it("testAddAccessor-adds_children", () => {
        const baseValue = { a: 1, b: 2 };
        const arrValue = [baseValue];
        const val = addAccessors(arrValue, baseValue);
        val.push({ a: "two" });
        expect(val.length).toBe(2);
        expect(val[1].a).toBe("two");
        expect(val.a).toBe(1);
        expect(val[0].a).toBe(1);
    });

    it("Does not double proxy", () => {
        const baseValue = { a: 1, b: 2 };
        const arrValue = [baseValue];
        const val = addAccessors(arrValue, baseValue);
        expect(val).toEqual(addAccessors(val));
        expect(val.__isProxy).toBe(true);
    });

    it("Handles non-array dest with no sqzero", () => {
        const baseValue = { a: 1, b: 2 };
        expect(Array.isArray(addAccessors(baseValue))).toBe(true);
        expect(addAccessors("Hello")).toBe("Hello");
        expect(addAccessors([baseValue])[0]).toBe(baseValue);
        expect(addAccessors([baseValue, 2])[1]).toBe(2);
    });
});
