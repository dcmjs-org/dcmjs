// test/eventStream/fromImage.test.js
//
// DicomEventStream.fromImage: decoded pixels -> event stream -> every sink.
// Round-trips through toPart10 -> DicomMessage.readFile prove the written
// instance carries the pixels byte-identically, and the encapsulated option
// exercises the fragment path end to end.

import dcmjs from "../../src/index.js";
import { validationLog } from "../../src/log.js";

validationLog.setLevel(5);

const { DicomEventStream } = dcmjs.eventStream;
const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const JPEG_BASELINE_TS = "1.2.840.10008.1.2.4.50";

function ramp16(rows, columns) {
    const pixels = new Uint16Array(rows * columns);
    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = i * 7;
    }
    return pixels;
}

function readBack(arrayBuffer) {
    const dicomDict = DicomMessage.readFile(arrayBuffer);
    return {
        meta: DicomMetaDictionary.naturalizeDataset(dicomDict.meta),
        dataset: DicomMetaDictionary.naturalizeDataset(dicomDict.dict)
    };
}

test("toPart10 round trip: geometry, meta group, byte-identical pixels", async () => {
    const pixels = ramp16(8, 8);
    const events = DicomEventStream.fromImage(
        { pixels, rows: 8, columns: 8, bitsStored: 12 },
        { PatientName: "FOX^JANE", PatientID: "22446688" }
    );

    const buffer = await events.toPart10();
    const { meta, dataset } = readBack(buffer);

    expect(dataset.Rows).toBe(8);
    expect(dataset.Columns).toBe(8);
    expect(dataset.BitsAllocated).toBe(16);
    expect(dataset.BitsStored).toBe(12);
    expect(String(dataset.PatientName)).toBe("FOX^JANE");
    expect(dataset.PatientID).toBe("22446688");

    expect(meta.MediaStorageSOPInstanceUID).toBe(dataset.SOPInstanceUID);
    expect(meta.TransferSyntaxUID).toBe("1.2.840.10008.1.2.1");

    let payload = dataset.PixelData;
    if (Array.isArray(payload)) {
        payload = payload[0];
    }
    const written = new Uint16Array(
        payload instanceof ArrayBuffer ? payload : payload.buffer
    );
    expect(written.length).toBe(pixels.length);
    expect(Array.from(written)).toEqual(Array.from(pixels));
});

test("streams are re-runnable with stable identity", async () => {
    const events = DicomEventStream.fromImage({
        pixels: new Uint8Array(16),
        rows: 4,
        columns: 4
    });

    const naturalized = await events.toNaturalized();
    const { dataset } = readBack(await events.toPart10());

    expect(dataset.SOPInstanceUID).toBe(naturalized.SOPInstanceUID);
});

test("toDicomWebJson carries geometry as tag-keyed entries", async () => {
    const events = DicomEventStream.fromImage({
        pixels: new Uint8Array(16),
        rows: 4,
        columns: 4
    });
    const json = await events.toDicomWebJson();
    // the denaturalizer carries US values as strings in DICOM JSON
    expect(Number(json["00280010"].Value[0])).toBe(4); // Rows
    expect(Number(json["00280011"].Value[0])).toBe(4); // Columns
});

test("encapsulated frames round-trip as fragments with their transfer syntax", async () => {
    const frameA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const frameB = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8]);

    const events = DicomEventStream.fromImage(
        { rows: 2, columns: 2, numberOfFrames: 2 },
        {
            encapsulated: {
                transferSyntaxUID: JPEG_BASELINE_TS,
                frames: [frameA, frameB]
            }
        }
    );

    const buffer = await events.toPart10();
    const { meta, dataset } = readBack(buffer);

    expect(meta.TransferSyntaxUID).toBe(JPEG_BASELINE_TS);
    expect(dataset.NumberOfFrames).toBe(2);

    const fragments = (Array.isArray(dataset.PixelData)
        ? dataset.PixelData
        : [dataset.PixelData]
    ).map(fragment =>
        Array.from(
            fragment instanceof ArrayBuffer
                ? new Uint8Array(fragment)
                : new Uint8Array(
                      fragment.buffer,
                      fragment.byteOffset,
                      fragment.byteLength
                  )
        )
    );
    expect(fragments).toEqual([Array.from(frameA), Array.from(frameB)]);
});
