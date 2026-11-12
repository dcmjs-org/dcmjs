import dcmjs from "../src/index.js";

const { DicomMessage, DicomMetaDictionary, datasetToDict } = dcmjs.data;
const { SecondaryCapture } = dcmjs.derivations;

const IMPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2";
const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";
const SC_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.7";

/** A reference instance to take patient and study context from. */
const reference = (transferSyntaxUID = EXPLICIT_LITTLE_ENDIAN) => ({
    PatientName: "Doe^John",
    PatientID: "12345",
    PatientBirthDate: "19700101",
    PatientSex: "M",
    StudyInstanceUID: "1.2.3.4",
    StudyID: "S1",
    StudyDate: "20261028",
    StudyTime: "120000",
    AccessionNumber: "A1",
    ReferringPhysicianName: "Who^Dr",
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.2",
    SOPInstanceUID: "1.2.3.4.5",
    _meta: {
        TransferSyntaxUID: { vr: "UI", Value: [transferSyntaxUID] }
    }
});

const rgb = (rows, columns) => {
    const data = new Uint8Array(rows * columns * 3);
    for (let i = 0; i < data.length; i++) {
        data[i] = (i * 7 + 3) & 0xff;
    }
    return data;
};

describe("SecondaryCapture", () => {
    it("writes the Secondary Capture Image attributes", () => {
        const sc = new SecondaryCapture([reference()], {
            SeriesDescription: "Screen capture"
        });
        sc.setPixels({ rows: 4, columns: 6, pixelData: rgb(4, 6) });

        const d = sc.dataset;
        expect(d.SOPClassUID).toEqual(SC_SOP_CLASS);
        expect(d.Modality).toEqual("OT");
        expect(d.ConversionType).toEqual("WSD");
        expect(d.ImageType).toEqual(["DERIVED", "SECONDARY", "OTHER"]);
        expect(d.SpecificCharacterSet).toEqual("ISO_IR 192");
        expect(d.LossyImageCompression).toEqual("00");
        expect(d.SeriesDescription).toEqual("Screen capture");
        expect(d.SOPInstanceUID).toBeTruthy();
        expect(d.SeriesInstanceUID).toBeTruthy();
    });

    it("declares burned in annotation, because a capture usually has text in it", () => {
        expect(
            new SecondaryCapture([reference()], {}).dataset.BurnedInAnnotation
        ).toEqual("YES");
        expect(
            new SecondaryCapture([reference()], {
                BurnedInAnnotation: "NO"
            }).dataset.BurnedInAnnotation
        ).toEqual("NO");
    });

    it("takes patient and study context from the reference but not its pixels", () => {
        const ref = reference();
        ref.Rows = 512;
        ref.Columns = 512;
        ref.NumberOfFrames = 100;
        ref.PixelData = [new Uint8Array(8).buffer];

        const sc = new SecondaryCapture([ref], {});
        sc.setPixels({ rows: 4, columns: 6, pixelData: rgb(4, 6) });

        expect(sc.dataset.PatientName).toEqual("Doe^John");
        expect(sc.dataset.StudyInstanceUID).toEqual("1.2.3.4");
        // the capture's own geometry, not the reference's
        expect(sc.dataset.Rows).toEqual(4);
        expect(sc.dataset.Columns).toEqual(6);
        expect(sc.dataset.NumberOfFrames).toBeUndefined();
        // a new instance in a new series
        expect(sc.dataset.SOPInstanceUID).not.toEqual(ref.SOPInstanceUID);
    });

    it("is not spatially registered", () => {
        const ref = reference();
        ref.FrameOfReferenceUID = "1.2.3.4.6";
        ref.ImagePositionPatient = [0, 0, 0];
        ref.ImageOrientationPatient = [1, 0, 0, 0, 1, 0];

        const sc = new SecondaryCapture([ref], {});
        // Inheriting these would invite a viewer to place a picture of a screen
        // in patient space.
        expect(sc.dataset.FrameOfReferenceUID).toBeUndefined();
        expect(sc.dataset.ImagePositionPatient).toBeUndefined();
        expect(sc.dataset.ImageOrientationPatient).toBeUndefined();
    });

    it("stays Explicit VR Little Endian even from an implicit VR reference", () => {
        // DerivedDataset copies _meta from the reference and datasetToDict keeps
        // whatever TransferSyntaxUID it finds there, so without pinning it an
        // implicit VR reference would silently make the capture implicit VR.
        const sc = new SecondaryCapture(
            [reference(IMPLICIT_LITTLE_ENDIAN)],
            {}
        );
        sc.setPixels({ rows: 4, columns: 6, pixelData: rgb(4, 6) });

        expect(sc.dataset._meta.TransferSyntaxUID.Value).toEqual([
            EXPLICIT_LITTLE_ENDIAN
        ]);

        const read = DicomMessage.readFile(datasetToDict(sc.dataset).write());
        expect(read.meta["00020010"].Value).toEqual([EXPLICIT_LITTLE_ENDIAN]);
    });

    it("round trips colour pixels byte for byte", () => {
        const rows = 24;
        const columns = 32;
        const pixelData = rgb(rows, columns);

        const sc = new SecondaryCapture([reference()], {});
        sc.setPixels({ rows, columns, pixelData });

        expect(sc.dataset.SamplesPerPixel).toEqual(3);
        expect(sc.dataset.PhotometricInterpretation).toEqual("RGB");
        expect(sc.dataset.PlanarConfiguration).toEqual(0);
        expect(sc.dataset.BitsAllocated).toEqual(8);
        expect(sc.dataset.BitsStored).toEqual(8);
        expect(sc.dataset.HighBit).toEqual(7);
        expect(sc.dataset.PixelRepresentation).toEqual(0);

        const dict = DicomMessage.readFile(
            datasetToDict(sc.dataset).write()
        ).dict;
        expect(dict["00280010"].Value).toEqual([rows]);
        expect(dict["00280011"].Value).toEqual([columns]);
        expect(new Uint8Array(dict["7FE00010"].Value[0])).toEqual(pixelData);
    });

    it("handles grayscale, and 16 bits", () => {
        const gray = new Uint8Array(4 * 6);
        gray.fill(128);
        const sc = new SecondaryCapture([reference()], {});
        sc.setPixels({ rows: 4, columns: 6, pixelData: gray });
        expect(sc.dataset.SamplesPerPixel).toEqual(1);
        expect(sc.dataset.PhotometricInterpretation).toEqual("MONOCHROME2");
        expect(sc.dataset.PlanarConfiguration).toBeUndefined();

        const deep = new Uint16Array(4 * 6);
        const sc16 = new SecondaryCapture([reference()], {});
        sc16.setPixels({
            rows: 4,
            columns: 6,
            pixelData: deep,
            samplesPerPixel: 1,
            bitsAllocated: 16
        });
        expect(sc16.dataset.BitsAllocated).toEqual(16);
        expect(sc16.dataset.HighBit).toEqual(15);
    });

    it("rejects pixel data that does not match the geometry", () => {
        const sc = new SecondaryCapture([reference()], {});
        expect(() =>
            sc.setPixels({ rows: 4, columns: 6, pixelData: new Uint8Array(10) })
        ).toThrow(/needs 24/);
        expect(() =>
            sc.setPixels({ rows: 0, columns: 6, pixelData: new Uint8Array(0) })
        ).toThrow(/positive integers/);
        expect(() =>
            sc.setPixels({
                rows: 4,
                columns: 6,
                pixelData: rgb(4, 6),
                bitsAllocated: 12
            })
        ).toThrow(/must be 8 or 16/);
        expect(() =>
            sc.setPixels({ rows: 4, columns: 6, pixelData: "not pixels" })
        ).toThrow(/ArrayBuffer/);
    });

    it("records referenced instances in standard attributes", () => {
        const sc = new SecondaryCapture([reference()], {
            referencedSeries: [
                {
                    SeriesInstanceUID: "1.2.3.4.100",
                    instances: [
                        {
                            SOPClassUID: "1.2.840.10008.5.1.4.1.1.2",
                            SOPInstanceUID: "1.2.3.4.100.1"
                        },
                        {
                            SOPClassUID: "1.2.840.10008.5.1.4.1.1.2",
                            SOPInstanceUID: "1.2.3.4.100.2"
                        }
                    ]
                },
                { SeriesInstanceUID: "1.2.3.4.200" }
            ]
        });
        sc.setPixels({ rows: 4, columns: 6, pixelData: rgb(4, 6) });

        const sequence = sc.dataset.ReferencedSeriesSequence;
        expect(sequence).toHaveLength(2);
        expect(sequence[0].SeriesInstanceUID).toEqual("1.2.3.4.100");
        expect(sequence[0].ReferencedInstanceSequence).toHaveLength(2);
        expect(
            sequence[0].ReferencedInstanceSequence[1].ReferencedSOPInstanceUID
        ).toEqual("1.2.3.4.100.2");
        expect(sequence[1].ReferencedInstanceSequence).toBeUndefined();

        // and it survives a write and a read
        const dict = DicomMessage.readFile(
            datasetToDict(sc.dataset).write()
        ).dict;
        const natural = DicomMetaDictionary.naturalizeDataset(dict);
        expect(
            natural.ReferencedSeriesSequence[0].ReferencedInstanceSequence[0]
                .ReferencedSOPInstanceUID
        ).toEqual("1.2.3.4.100.1");
    });

    it("accepts a view over part of a larger buffer", () => {
        const backing = new Uint8Array(1000);
        const view = backing.subarray(100, 100 + 4 * 6 * 3);
        for (let i = 0; i < view.length; i++) {
            view[i] = i & 0xff;
        }
        const sc = new SecondaryCapture([reference()], {});
        sc.setPixels({ rows: 4, columns: 6, pixelData: view });

        const dict = DicomMessage.readFile(
            datasetToDict(sc.dataset).write()
        ).dict;
        expect(new Uint8Array(dict["7FE00010"].Value[0])).toEqual(
            new Uint8Array(view)
        );
    });
});
