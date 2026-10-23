/**
 * The PN setter and the upsert utilities of the naturalized form
 * (docs/specs/naturalized-dataset.md, NAT-U-VAL-5 and NAT-U-UPS).
 */
import dcmjs from "../../src/index.js";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { setVr, upsertAttribute, upsertPersonName } from "@dcmjs-org/core";

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

    it("upsertAttribute shapes a value by its length and records the VR", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset(sourceDict());
        expect(upsertAttribute(dataset, "00311001", "x", { vr: "LO" })).toEqual(
            ["x"]
        );
        expect(
            upsertAttribute(dataset, "00311002", ["y"], { vr: "LO", length: 1 })
        ).toBe("y");
        expect(dataset._vrMap["00311001"]).toBe("LO");
        // a private alias stores into its block, with the VR in the block
        upsertAttribute(dataset, "00291001", "b", { vr: "SH" });
        expect(dataset["0029:ACME"].x01).toEqual(["b"]);
        expect(dataset._vrMap["0029:ACME"].x01).toBe("SH");
    });

    it("upsertPersonName adds a converting PN attribute; setVr creates _vrMap", () => {
        const dataset = {};
        upsertPersonName(dataset, "00311010", "Doe^John", 1);
        expect(dataset["00311010"].Alphabetic).toBe("Doe^John");
        expect(dataset._vrMap["00311010"]).toBe("PN");
        dataset["00311010"] = "Roe^Ann";
        expect(dataset["00311010"].Alphabetic).toBe("Roe^Ann");

        const empty = {};
        setVr(empty, "00311020", "UN");
        expect(empty._vrMap).toEqual({ "00311020": "UN" });
    });
});
