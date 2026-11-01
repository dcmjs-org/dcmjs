// packages/core/test/createInstance.test.js
//
// The instance builder: base blocks, level-aware identity, precedence, and
// the composition helpers.

import {
    createInstance,
    combineBases,
    DATA_LEVELS,
    deepCloneInstance,
    DicomMetaDictionary,
    extendDataLevels,
    defaultInstanceBase,
    nextSeriesNumberBase,
    predecessorBase,
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
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Modality/));

        // An override of any value decides Modality, so no warning.
        warn.mockClear();
        createInstance({
            baseDicom: docBase,
            instance: source,
            dataLevel: "series",
            overrides: { Modality: undefined }
        });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it("overrides win, and carry instance-level values", () => {
        const ds = createInstance({
            instance: source,
            overrides: {
                PatientName: "Override^Name",
                SeriesNumber: 42,
                SOPInstanceUID: "1.2.3.4.5.6.7.200"
            }
        });
        expect(ds.PatientName).toBe("Override^Name");
        expect(ds.SeriesNumber).toBe(42);
        expect(ds.SOPInstanceUID).toBe("1.2.3.4.5.6.7.200");

        // A _meta override merges into the base _meta.
        const meta = createInstance({
            overrides: { _meta: { ImplementationVersionName: "x" } }
        })._meta;
        expect(meta.ImplementationVersionName).toBe("x");
        expect(meta.TransferSyntaxUID.Value[0]).toBe("1.2.840.10008.1.2.1");
    });

    // API: overrides takes the provider forms of baseDicom (CORE-USR-1).
    it("resolves overrides as a function of the context and as an array", () => {
        const fromContext = createInstance({
            instance: source,
            overrides: context => ({
                SeriesDescription: context.inherits("study") ? "same" : "new"
            })
        });
        expect(fromContext.SeriesDescription).toBe("same");

        const fromArray = createInstance({
            overrides: [
                { PatientID: "A", PatientName: "X" },
                { PatientID: "B" }
            ]
        });
        expect(fromArray.PatientID).toBe("B");
        expect(fromArray.PatientName).toBe("X");
    });

    it("an inherited study or series gets Type 2 empty values, and a source value wins", () => {
        const bare = { ...source };
        delete bare.SeriesNumber;
        const empty = createInstance({ instance: bare, dataLevel: "series" });
        expect(empty.StudyDate).toBe("");
        expect(empty.StudyTime).toBe("");
        expect(empty.SeriesNumber).toBe("");
        expect(empty.StudyInstanceUID).toBe("1.2.3.4.5");

        const full = createInstance({
            instance: { ...source, StudyDate: "20240102" },
            dataLevel: "series"
        });
        expect(full.StudyDate).toBe("20240102");
        expect(full.SeriesNumber).toBe(3);
    });

    // API: CORE-USR-8 and CORE-USR-15.
    it("an undefined override removes the attribute; null and '' stay", () => {
        const ds = createInstance({
            overrides: {
                PatientName: undefined,
                StudyID: null,
                AccessionNumber: ""
            }
        });
        expect(ds).not.toHaveProperty("PatientName");
        expect(ds.StudyID).toBeNull();
        expect(ds.AccessionNumber).toBe("");
        expect(
            createInstance({
                instance: source,
                dataLevel: "series",
                overrides: { SeriesNumber: undefined }
            })
        ).not.toHaveProperty("SeriesNumber");

        // A custom postProcess replaces the default, and gets the context.
        const postProcess = jest.fn(dataset => dataset);
        const kept = createInstance({
            dataLevel: "patient",
            overrides: { PatientName: undefined },
            postProcess
        });
        expect(kept).toHaveProperty("PatientName", undefined);
        expect(postProcess).toHaveBeenCalledWith(
            kept,
            expect.objectContaining({ dataLevel: "patient" })
        );
    });

    // API: the level list decides what is copied (CORE-USR-4).
    it("the default levels do not copy the source identity", () => {
        const options = { instance: source, dataLevel: "series" };
        const ds = createInstance(options);
        expect(ds.SOPInstanceUID).not.toBe(source.SOPInstanceUID);
        expect(ds.SOPClassUID).toBeUndefined();
        expect(ds.InstanceNumber).toBe(8);

        // A custom levels list copies what it lists.
        const levels = extendDataLevels(DATA_LEVELS, {
            series: ["SOPInstanceUID"]
        });
        expect(createInstance({ ...options, levels }).SOPInstanceUID).toBe(
            source.SOPInstanceUID
        );

        const set = createInstance({
            ...options,
            overrides: { SOPInstanceUID: "1.2.3.4.5.6.7.200" }
        });
        expect(set.SOPInstanceUID).toBe("1.2.3.4.5.6.7.200");

        const next = createInstance({
            ...options,
            baseDicom: combineBases(defaultInstanceBase, predecessorBase),
            predecessor: true
        });
        expect(next.SOPInstanceUID).not.toBe(source.SOPInstanceUID);
        const [study] = next.PredecessorDocumentsSequence;
        expect(
            study.ReferencedSeriesSequence[0].ReferencedSOPSequence[0]
                .ReferencedSOPInstanceUID
        ).toBe(source.SOPInstanceUID);
    });

    // User experience: a new instance in a series follows the sample one.
    it("at 'series', InstanceNumber is the sample InstanceNumber + 1", () => {
        const next = options =>
            createInstance({ instance: source, ...options });
        expect(next({ dataLevel: "series" }).InstanceNumber).toBe(8);
        // Only the first item is the sample.
        expect(
            next({
                instance: [source, { ...source, InstanceNumber: 20 }],
                dataLevel: "series"
            }).InstanceNumber
        ).toBe(8);
        expect(next({ dataLevel: "study" }).InstanceNumber).toBe(1);
        const bare = { ...source };
        delete bare.InstanceNumber;
        expect(
            next({ instance: bare, dataLevel: "series" }).InstanceNumber
        ).toBe(1);
        expect(
            next({ dataLevel: "series", overrides: { InstanceNumber: 3 } })
                .InstanceNumber
        ).toBe(3);
        // The IS maximum has no next value.
        expect(
            next({
                instance: { ...source, InstanceNumber: 2147483647 },
                dataLevel: "series"
            }).InstanceNumber
        ).toBe(1);
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

    it("deepCloneInstance keeps the naturalized shape: one-item sequences, private aliases and their deletes", () => {
        const natural = DicomMetaDictionary.naturalizeDataset({
            "00290010": { vr: "LO", Value: ["ACME"] },
            "00291001": { vr: "US", Value: [7] },
            "00291002": { vr: "US", Value: [8] },
            "00081115": {
                vr: "SQ",
                Value: [
                    {
                        "00081155": { vr: "UI", Value: ["1.2"] },
                        "00330010": { vr: "LO", Value: ["SEQ"] },
                        "00331001": { vr: "LO", Value: ["inner"] }
                    }
                ]
            }
        });
        delete natural["00291002"];
        const copy = deepCloneInstance(natural);

        const seq = copy.ReferencedSeriesSequence;
        expect(seq).not.toBe(natural.ReferencedSeriesSequence);
        expect(seq[0].ReferencedSOPInstanceUID).toBe("1.2");
        expect(seq.length).toBe(1);
        expect(seq["00331001"]).toEqual(["inner"]);
        expect(copy["00291001"]).toEqual([7]);
        // a deleted alias stays deleted in the copy, so the copy does not write it
        const dict = DicomMetaDictionary.denaturalizeDataset(copy);
        expect(dict["00291001"]).toBeDefined();
        expect(dict["00291002"]).toBeUndefined();
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
        // API: an instance without SOPInstanceUID throws (CORE-USR-9).
        const { SOPInstanceUID: _omit, ...noUid } = source;
        expect(() =>
            createInstance({
                baseDicom: base,
                instance: noUid,
                predecessor: true
            })
        ).toThrow(/missing SOPInstanceUID/);
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
        const atMax = createInstance({
            baseDicom: [
                defaultInstanceBase,
                nextSeriesNumberBase([{ SeriesNumber: 2147483647 }])
            ]
        });
        expect(atMax.SeriesNumber).toBe(1);
    });
});
