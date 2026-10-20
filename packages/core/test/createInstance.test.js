// packages/core/test/createInstance.test.js
//
// The instance builder: base blocks, level-aware identity, precedence, and
// the composition helpers.

import {
    createInstance,
    combineBases,
    deepCloneInstance,
    defaultInstanceBase,
    nextSeriesNumberBase,
    predecessorBase,
    registerTag,
    log
} from "../src/index.js";

const source = {
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.4",
    SOPInstanceUID: "1.2.3.4.5.6.7.100",
    StudyInstanceUID: "1.2.3.4.5",
    SeriesInstanceUID: "1.2.3.4.5.9",
    Modality: "MR",
    PatientName: "Doe^Jane",
    SeriesNumber: 3,
    SeriesDescription: "AX T1",
    InstanceNumber: 7
};

const docBase = combineBases(defaultInstanceBase, {
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.104.1",
    Modality: "DOC"
});

describe("createInstance", () => {
    it("creates new identity at every level without an instance", () => {
        const ds = createInstance();
        expect(ds.StudyInstanceUID).toMatch(/^2\.25\./);
        expect(ds.SeriesInstanceUID).toMatch(/^2\.25\./);
        expect(ds.SOPInstanceUID).toMatch(/^2\.25\./);
        expect(ds.SeriesNumber).toBe(1);
        expect(ds.PatientName).toBe("");
        expect(ds._meta.TransferSyntaxUID.Value[0]).toBe("1.2.840.10008.1.2.1");
    });

    it("at 'study', joins the study in a new series with base labels", () => {
        const ds = createInstance({ baseDicom: docBase, instance: source });
        expect(ds.StudyInstanceUID).toBe("1.2.3.4.5");
        expect(ds.PatientName).toBe("Doe^Jane");
        expect(ds.SeriesInstanceUID).not.toBe("1.2.3.4.5.9");
        expect(ds.SeriesNumber).toBe(1);
        expect(ds.SeriesDescription).toBeUndefined();
        expect(ds.Modality).toBe("DOC");
    });

    it("at 'series', joins the existing series and warns on a Modality mismatch", () => {
        const warn = jest.spyOn(log, "warn").mockImplementation(() => {});
        const ds = createInstance({
            baseDicom: docBase,
            instance: source,
            dataLevel: "series"
        });
        expect(ds.SeriesInstanceUID).toBe("1.2.3.4.5.9");
        expect(ds.SeriesNumber).toBe(3);
        expect(ds.SeriesDescription).toBe("AX T1");
        expect(ds.SOPInstanceUID).not.toBe("1.2.3.4.5.6.7.100");
        expect(ds.InstanceNumber).toBe(1);
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Modality/));
        warn.mockRestore();
    });

    it("explicit overrides win, and carry instance-level values", () => {
        const ds = createInstance({
            instance: source,
            PatientName: "Override^Name",
            SeriesNumber: 42,
            SOPInstanceUID: "1.2.3.4.5.6.7.200"
        });
        expect(ds.PatientName).toBe("Override^Name");
        expect(ds.SeriesNumber).toBe(42);
        expect(ds.SOPInstanceUID).toBe("1.2.3.4.5.6.7.200");
    });

    it("writes only DICOM attributes, and warns for any other key", () => {
        const warn = jest.spyOn(log, "warn").mockImplementation(() => {});
        registerTag("00111010", { name: "TestRegisteredName", vr: "LO" });
        const ds = createInstance({
            PatientID: "P1",
            "00091010": "private",
            TestRegisteredName: "registered",
            onProgress: () => {}
        });
        expect(ds.PatientID).toBe("P1");
        expect(ds["00091010"]).toBe("private");
        expect(ds.TestRegisteredName).toBe("registered");
        expect(ds.onProgress).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
            expect.stringMatching(/"onProgress" is not a DICOM attribute/)
        );
        warn.mockRestore();
    });

    it("has no instance level", () => {
        expect(() =>
            createInstance({ instance: source, dataLevel: "instance" })
        ).toThrow(/dataLevel/);
    });
});

describe("base blocks", () => {
    it("combine in order, and expose their parts to build a variant", () => {
        const custom = { Manufacturer: "custom" };
        const base = combineBases(defaultInstanceBase, custom);
        expect(createInstance({ baseDicom: base }).Manufacturer).toBe("custom");

        const variant = combineBases(
            ...base.items.filter(item => item !== custom)
        );
        expect(createInstance({ baseDicom: variant }).Manufacturer).toBe(
            "dcmjs"
        );
    });

    it("accept an array as a combination, and functions get the context", () => {
        const ds = createInstance({
            baseDicom: [
                defaultInstanceBase,
                context => ({ SeriesDescription: `level ${context.dataLevel}` })
            ],
            dataLevel: "patient"
        });
        expect(ds.SeriesDescription).toBe("level patient");
    });

    it("deepCloneInstance of a block clones what the block returns", () => {
        const codes = [{ CodeValue: "113100" }];
        const shared = () => ({ DeidentificationMethodCodeSequence: codes });
        const base = deepCloneInstance(
            combineBases(defaultInstanceBase, shared)
        );
        const ds = createInstance({ baseDicom: base });
        expect(ds.DeidentificationMethodCodeSequence).toEqual(codes);
        expect(ds.DeidentificationMethodCodeSequence).not.toBe(codes);
        expect(base.items).toHaveLength(2);
    });

    it("deepCloneInstance shares binary unless copyBinary, and clones a promise value", async () => {
        const pixels = new ArrayBuffer(8);
        const source = { PixelData: [pixels], Seq: [{ A: 1 }] };
        expect(deepCloneInstance(source).PixelData[0]).toBe(pixels);
        expect(
            deepCloneInstance(source, { copyBinary: true }).PixelData[0]
        ).not.toBe(pixels);

        const resolved = await deepCloneInstance(Promise.resolve(source));
        expect(resolved.Seq).toEqual(source.Seq);
        expect(resolved.Seq).not.toBe(source.Seq);
    });

    it("predecessorBase references each instance by study and series, only when asked", () => {
        const older = [
            source,
            { ...source, SOPInstanceUID: "1.2.3.4.5.6.7.101" },
            {
                ...source,
                SeriesInstanceUID: "1.2.3.4.5.10",
                SOPInstanceUID: "1.2.3.4.5.6.7.102"
            }
        ];
        const base = combineBases(defaultInstanceBase, predecessorBase);
        const ds = createInstance({
            baseDicom: base,
            instance: older,
            predecessor: true
        });
        const [study] = ds.PredecessorDocumentsSequence;
        expect(study.StudyInstanceUID).toBe("1.2.3.4.5");
        expect(
            study.ReferencedSeriesSequence.map(s => [
                s.SeriesInstanceUID,
                s.ReferencedSOPSequence.length
            ])
        ).toEqual([
            ["1.2.3.4.5.9", 2],
            ["1.2.3.4.5.10", 1]
        ]);
        expect(ds).not.toHaveProperty("predecessor");

        expect(
            createInstance({ baseDicom: base, instance: older })
        ).not.toHaveProperty("PredecessorDocumentsSequence");
        expect(
            createInstance({ instance: older, predecessor: true })
        ).not.toHaveProperty("PredecessorDocumentsSequence");
    });

    it("nextSeriesNumberBase counts naturalized and DICOM JSON series", () => {
        const qido = [
            { SeriesNumber: 4, Modality: "MR" },
            {
                "00200011": { vr: "IS", Value: [9] },
                "00080060": { Value: ["SR"] }
            },
            { SeriesNumber: 12, Modality: "CT" }
        ];
        const notCt = series =>
            (series.Modality ?? series["00080060"]?.Value?.[0]) !== "CT";
        const ds = createInstance({
            baseDicom: [defaultInstanceBase, nextSeriesNumberBase(qido, notCt)]
        });
        expect(ds.SeriesNumber).toBe(10);
    });
});
