/**
 * The PN setter and the set utilities of the naturalized form
 * (docs/specs/naturalized-dataset.md, NAT-U-VAL-5 and NAT-U-SET).
 */
// The registerTag() entries of these tests stay registered only in this
// file: jest gives each test file its own module registry.
import dcmjs from "../../src/index.js";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { setVr, setAttribute, setPersonName } from "@dcmjs-org/core";

const { DicomMetaDictionary } = dcmjs.data;

const sourceDict = () => ({
    "00100010": { vr: "PN", Value: [{ Alphabetic: "Doe^Jane" }] },
    "00101001": { vr: "PN", Value: [{ Alphabetic: "Roe^Ann" }] },
    "00290010": { vr: "LO", Value: ["ACME"] },
    "00291001": { vr: "LO", Value: ["a"] }
});

describe("naturalized attributes", () => {
    it("an assigned PN string converts to the component form, in both producers", async () => {
        const listener = new NaturalizedListener();
        await fromDataSet({ dict: sourceDict() }, listener);
        for (const dataset of [
            DicomMetaDictionary.naturalizeDataset(sourceDict()),
            listener.result
        ]) {
            dataset.PatientName = "Doe^John";
            expect(dataset.PatientName.Alphabetic).toBe("Doe^John");
            expect(String(dataset.PatientName)).toBe("Doe^John");
            // OtherPatientNames has VM 1-n, so a list
            dataset.OtherPatientNames = "A^B\\C^D";
            expect(dataset.OtherPatientNames.map(n => n.Alphabetic)).toEqual([
                "A^B",
                "C^D"
            ]);
            const dict = DicomMetaDictionary.denaturalizeDataset(dataset);
            expect(dict["00100010"].Value).toEqual([
                { Alphabetic: "Doe^John" }
            ]);
        }
    });

    it("setAttribute shapes a value by its length and records the VR", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset(sourceDict());
        expect(setAttribute(dataset, "00311001", "x", { vr: "LO" })).toEqual([
            "x"
        ]);
        expect(
            setAttribute(dataset, "00311002", ["y"], { vr: "LO", length: 1 })
        ).toBe("y");
        expect(dataset._vrMap["00311001"]).toBe("LO");
        // a private alias stores into its block, with the VR in the block
        setAttribute(dataset, "00291001", "b", { vr: "SH" });
        expect(dataset["0029:ACME"].x01).toEqual(["b"]);
        expect(dataset._vrMap["0029:ACME"].x01).toBe("SH");
    });

    it("with no length, the dictionary VM decides, and a hex key is normalized", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset(sourceDict());
        expect(setAttribute(dataset, "PatientID", "X")).toBe("X");
        setPersonName(dataset, "PatientName", "A^B");
        dataset.PatientName = "C^D"; // VM 1: still one name
        expect(dataset.PatientName.Alphabetic).toBe("C^D");
        // a standard hex tag is its keyword; a private one is uppercase
        setAttribute(dataset, "00100020", "Y");
        expect(dataset.PatientID).toBe("Y");
        expect("00100020" in dataset).toBe(false);
        setAttribute(dataset, "0029100a", "b", { vr: "LO" });
        expect(Object.keys(dataset)).toContain("0029100A");
        // a VR change replaces the PN setter with plain data
        setAttribute(dataset, "PatientName", "raw", { vr: "LO" });
        expect(dataset.PatientName).toBe("raw");
    });

    it("a private PN element converts later strings, and nested lists flatten", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset(sourceDict());
        setPersonName(dataset, "00291001", "A^B", 1);
        dataset["00291001"] = "C^D";
        expect(dataset["0029:ACME"].x01.map(n => n.Alphabetic)).toEqual([
            "C^D"
        ]);
        dataset.OtherPatientNames = [["E^F"], "G^H"];
        expect(dataset.OtherPatientNames).toHaveLength(2);
    });

    it("setAttribute stores a sequence in the naturalized form", () => {
        const dataset = {};
        const item = { CodeValue: "113000" };
        const one = setAttribute(dataset, "ConceptNameCodeSequence", [item]);
        expect(one[0]).toBe(item); // the array-like item object
        expect([...one]).toEqual([item]);
        expect(setAttribute(dataset, "ConceptNameCodeSequence", [])).toEqual(
            []
        );
    });

    it("a hex key of a flat registerTag() element sets that element", () => {
        const { registerTag } = require("../../src/dictionary.fast.js");
        registerTag("00351001", { name: "SetFlatTag", vr: "LO", vm: "1" });
        const dataset = DicomMetaDictionary.naturalizeDataset({
            "00351001": { vr: "LO", Value: ["one"] }
        });
        setAttribute(dataset, "00351001", "two");
        expect(dataset.SetFlatTag).toBe("two");
        expect(
            DicomMetaDictionary.denaturalizeDataset(dataset)["00351001"].Value
        ).toEqual(["two"]);
    });

    it("a private PN element with no creator converts an assigned string", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset({
            "00311002": { vr: "PN", Value: [{ Alphabetic: "A^B" }] }
        });
        dataset["00311002"] = "X^Y";
        expect(dataset["00311002"][0].Alphabetic).toBe("X^Y");
    });

    it("a set on a deleted hex alias makes a new element, also with a registered keyword", () => {
        const { registerTag } = require("../../src/dictionary.fast.js");
        registerTag("00431001", { name: "BlockKeywordTag", vr: "LO", vm: "1" });
        const dataset = DicomMetaDictionary.naturalizeDataset({
            "00430010": { vr: "LO", Value: ["ACME"] },
            "00431001": { vr: "LO", Value: ["secret"] }
        });
        delete dataset["00431001"];
        setAttribute(dataset, "00431001", "REDACTED");
        expect(
            DicomMetaDictionary.denaturalizeDataset(dataset)["00431001"].Value
        ).toEqual(["REDACTED"]);
    });

    it("setAttribute gives a binary attribute a list of ArrayBuffer, also for ox", () => {
        const dataset = {};
        const bytes = new Uint8Array([9, 1, 2, 9]);
        setAttribute(dataset, "PixelData", bytes.subarray(1, 3));
        expect(dataset.PixelData).toHaveLength(1);
        expect(dataset.PixelData[0]).toBeInstanceOf(ArrayBuffer);
        expect([...new Uint8Array(dataset.PixelData[0])]).toEqual([1, 2]);
        expect(dataset._vrMap?.PixelData).toBeUndefined(); // no "ox" entry
        expect(() =>
            setAttribute(dataset, "PixelData", bytes, { binaryAs: "Blob" })
        ).toThrow(TypeError);
    });

    it("a private creator alias is read-only for the set utilities", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset(sourceDict());
        expect(() => setAttribute(dataset, "00290010", "X")).toThrow(
            /creator of private block/
        );
        expect(() => setPersonName(dataset, "00290010", "X")).toThrow(
            /creator of private block/
        );
        setVr(dataset, "00290010", "UN");
        expect(dataset._vrMap["00290010"]).toBeUndefined();
    });

    it("setPersonName adds a converting PN attribute; setVr creates _vrMap", () => {
        const dataset = {};
        setPersonName(dataset, "00311010", "Doe^John", 1);
        expect(dataset["00311010"].Alphabetic).toBe("Doe^John");
        expect(dataset._vrMap["00311010"]).toBe("PN");
        dataset["00311010"] = "Roe^Ann";
        expect(dataset["00311010"].Alphabetic).toBe("Roe^Ann");

        const empty = {};
        setVr(empty, "00311020", "UN");
        expect(empty._vrMap).toEqual({ "00311020": "UN" });
    });
});
