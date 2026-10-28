import DerivedDataset from "./DerivedDataset.js";
import { DicomMetaDictionary } from "../DicomMetaDictionary.js";

const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";

/**
 * A Secondary Capture Image, for images that did not come from an imaging
 * device directly: a screen capture, a scanned document, a photograph, a
 * rendering.
 *
 * It derives from DerivedDataset rather than DerivedPixels because the pixels
 * are NOT derived from the reference instance - they are supplied by the
 * caller, and nothing about the reference's pixel geometry, frame count or
 * PixelData should be inherited. What is taken from the reference is the
 * composite context (patient and study), so the capture files alongside the
 * images it relates to.
 *
 *     const sc = new SecondaryCapture([referenceDataset], {
 *         SeriesDescription: "Screen capture",
 *         referencedSeries: [{
 *             SeriesInstanceUID: "1.2.3",
 *             instances: [{ SOPClassUID: "1.2.840.10008.5.1.4.1.1.2", SOPInstanceUID: "1.2.3.4" }]
 *         }]
 *     });
 *     sc.setPixels({ rows: 768, columns: 1024, pixelData: rgbBytes });
 *     const buffer = datasetToDict(sc.dataset).write();
 */
export default class SecondaryCapture extends DerivedDataset {
    constructor(datasets, options = {}) {
        super(datasets, options);
    }

    derive() {
        super.derive();

        this.assignToDataset({
            SOPClassUID:
                DicomMetaDictionary.sopClassUIDsByName.SecondaryCaptureImage,
            Modality: this.options.Modality || "OT",
            // PS3.3 C.8.6.1: WSD is a workstation, the usual source of a capture
            ConversionType: this.options.ConversionType || "WSD",
            ImageType: ["DERIVED", "SECONDARY", "OTHER"],
            SpecificCharacterSet: "ISO_IR 192",
            InstanceNumber: String(this.options.InstanceNumber || 1),
            PresentationLUTShape: "IDENTITY",
            LossyImageCompression: "00",
            // A screen capture normally has patient-identifying text drawn into
            // it, so the safe default is to say so: a de-identifier that trusts
            // a "NO" here will pass the pixels through untouched. Override for a
            // capture that genuinely carries no annotation.
            BurnedInAnnotation: this.options.BurnedInAnnotation || "YES"
        });

        this.assignToDataset({
            SecondaryCaptureDeviceManufacturer: this.options.Manufacturer,
            SecondaryCaptureDeviceManufacturerModelName:
                this.options.ManufacturerModelName,
            SecondaryCaptureDeviceSoftwareVersions:
                this.options.SoftwareVersions
        });

        // A Secondary Capture is a picture of a screen, not a registered slice.
        // Inheriting a frame of reference or an image position from the
        // reference would invite a viewer to place it in space, so they are
        // deliberately absent rather than copied.

        // The file meta is rebuilt by datasetToDict() from the dataset's own
        // SOP class and instance, but it keeps whatever TransferSyntaxUID it
        // finds - and DerivedDataset copies _meta from the reference. So a
        // reference read from an implicit VR file would silently make this
        // capture implicit VR too. Pin it.
        this.dataset._meta = {
            ...(this.dataset._meta || {}),
            TransferSyntaxUID: {
                vr: "UI",
                Value: [EXPLICIT_LITTLE_ENDIAN]
            }
        };

        if (this.options.referencedSeries) {
            this.assignToDataset({
                ReferencedSeriesSequence: referencedSeriesSequence(
                    this.options.referencedSeries
                )
            });
        }
    }

    /**
     * Set the capture's pixels and the Image Pixel module that describes them.
     *
     * @param {object} options
     * @param {number} options.rows
     * @param {number} options.columns
     * @param {ArrayBuffer|ArrayBufferView} options.pixelData uncompressed, with
     *     colour samples interleaved by pixel (PlanarConfiguration 0)
     * @param {number} [options.samplesPerPixel] 3 for colour, 1 for grayscale;
     *     inferred from the data length when not given
     * @param {number} [options.bitsAllocated] 8 or 16, default 8
     * @param {string} [options.photometricInterpretation] default RGB for 3
     *     samples, MONOCHROME2 for 1
     * @returns {void}
     */
    setPixels({
        rows,
        columns,
        pixelData,
        samplesPerPixel,
        bitsAllocated = 8,
        photometricInterpretation
    }) {
        if (
            !Number.isInteger(rows) ||
            !Number.isInteger(columns) ||
            rows <= 0 ||
            columns <= 0
        ) {
            throw new Error(
                `rows and columns must be positive integers, got ${rows} x ${columns}`
            );
        }
        if (bitsAllocated !== 8 && bitsAllocated !== 16) {
            throw new Error(
                `bitsAllocated must be 8 or 16, got ${bitsAllocated}`
            );
        }
        const buffer = asArrayBuffer(pixelData);
        if (!buffer) {
            throw new Error(
                "pixelData must be an ArrayBuffer or a view on one"
            );
        }

        const bytesPerSample = bitsAllocated / 8;
        const samples =
            samplesPerPixel ??
            inferSamplesPerPixel(
                buffer.byteLength,
                rows,
                columns,
                bytesPerSample
            );
        if (samples !== 1 && samples !== 3) {
            throw new Error(`samplesPerPixel must be 1 or 3, got ${samples}`);
        }

        const expected = rows * columns * samples * bytesPerSample;
        if (buffer.byteLength !== expected) {
            throw new Error(
                `pixelData is ${buffer.byteLength} bytes but ${rows} x ${columns} at ` +
                    `${samples} sample(s) of ${bitsAllocated} bits needs ${expected}`
            );
        }

        const photometric =
            photometricInterpretation ??
            (samples === 3 ? "RGB" : "MONOCHROME2");

        this.assignToDataset({
            Rows: rows,
            Columns: columns,
            SamplesPerPixel: samples,
            PhotometricInterpretation: photometric,
            BitsAllocated: bitsAllocated,
            BitsStored: bitsAllocated,
            HighBit: bitsAllocated - 1,
            PixelRepresentation: 0,
            PixelData: [buffer]
        });
        if (samples === 3) {
            // colour samples are interleaved by pixel, not sent as planes
            this.assignToDataset({ PlanarConfiguration: 0 });
        }
    }
}

/** A Uint8Array-backed ArrayBuffer for data, or undefined if it is not one. */
function asArrayBuffer(data) {
    if (ArrayBuffer.isView(data)) {
        // a view may cover only part of its buffer, so copy that part out
        return data.byteOffset === 0 &&
            data.byteLength === data.buffer.byteLength
            ? data.buffer
            : data.buffer.slice(
                  data.byteOffset,
                  data.byteOffset + data.byteLength
              );
    }
    // Deliberately not `instanceof ArrayBuffer`: a buffer from a worker, an
    // iframe or jsdom comes from another realm, where that test is false.
    if (data && typeof data.byteLength === "number") {
        return data;
    }
    return undefined;
}

function inferSamplesPerPixel(byteLength, rows, columns, bytesPerSample) {
    const pixels = rows * columns * bytesPerSample;
    if (pixels > 0 && byteLength === pixels * 3) {
        return 3;
    }
    return 1;
}

/** Build a Common Instance Reference sequence (PS3.3 C.12.2). */
function referencedSeriesSequence(series) {
    const list = Array.isArray(series) ? series : [series];
    return list.map(entry => {
        const item = { SeriesInstanceUID: entry.SeriesInstanceUID };
        const instances = entry.instances || entry.ReferencedInstanceSequence;
        if (instances && instances.length) {
            item.ReferencedInstanceSequence = instances.map(instance => ({
                ReferencedSOPClassUID:
                    instance.ReferencedSOPClassUID || instance.SOPClassUID,
                ReferencedSOPInstanceUID:
                    instance.ReferencedSOPInstanceUID || instance.SOPInstanceUID
            }));
        }
        return item;
    });
}
