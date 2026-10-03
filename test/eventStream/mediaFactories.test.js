// test/eventStream/mediaFactories.test.js
//
// The DicomEventStream media factories (review finding 14 + the pdf/video
// facade round trips).
//
// Finding 14: the v2 video factories called createVideoEventSource(...)
// eagerly at factory time, so a bad input produced an unhandled promise
// rejection before anyone called .process() — Node terminates the process
// under the default --unhandled-rejections=throw. The contract is that the
// error surfaces from .process() (or any sink), and ONLY from there. The
// first two tests pin that contract via process.on("unhandledRejection").

import dcmjs from "../../src/index.js";
import { validationLog } from "../../src/log.js";
import { makeTinyMp4 } from "../../packages/video/test/utils/makeTinyMp4.js";

validationLog.setLevel(5);

const { DicomEventStream } = dcmjs.eventStream;
const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.77.1.4.1";
const ENCAPSULATED_PDF_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.104.1";

/** Collect unhandled rejections across a scope; restore handlers after. */
async function withUnhandledRejectionCapture(scope) {
    const captured = [];
    const onUnhandled = reason => captured.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
        await scope();
        // Unhandled rejections surface on later macrotask ticks; give the
        // event loop a few turns so a leak has every chance to fire.
        for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setImmediate(resolve));
        }
    } finally {
        process.removeListener("unhandledRejection", onUnhandled);
    }
    return captured;
}

test("finding 14: fromVideo(garbage) does not throw an unhandled rejection before .process()", async () => {
    const garbageBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const captured = await withUnhandledRejectionCapture(async () => {
        const events = DicomEventStream.fromVideo(garbageBytes);
        // An unrelated await — exactly the sequence that crashed under the
        // eager factory, because nothing had a handler on the source yet.
        await new Promise(resolve => setTimeout(resolve, 20));
        // The error must surface from the sink call, not the factory.
        await expect(events.toPart10()).rejects.toThrow(/MP4|ftyp/i);
    });

    expect(captured).toEqual([]);
});

test("finding 14: fromVideoStream(bad reader) is just as lazy", async () => {
    const garbage = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);
    const reader = {
        size: garbage.byteLength,
        read: (offset, length) =>
            Promise.resolve(garbage.subarray(offset, offset + length))
    };

    const captured = await withUnhandledRejectionCapture(async () => {
        const events = DicomEventStream.fromVideoStream(reader);
        await new Promise(resolve => setTimeout(resolve, 20));
        await expect(events.process(() => {})).rejects.toThrow(/MP4|ftyp/i);
    });

    expect(captured).toEqual([]);
});

function readBack(arrayBuffer) {
    const dicomDict = DicomMessage.readFile(arrayBuffer);
    return {
        meta: DicomMetaDictionary.naturalizeDataset(dicomDict.meta),
        dataset: DicomMetaDictionary.naturalizeDataset(dicomDict.dict)
    };
}

test("fromVideo → toPart10 → toVideo recovers the MP4 byte-identically", async () => {
    const mp4 = makeTinyMp4();

    const buffer = await DicomEventStream.fromVideo(mp4, {
        PatientName: "FOX^JANE"
    }).toPart10();

    const { meta, dataset } = readBack(buffer);
    expect(dataset.SOPClassUID).toBe(VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID);
    expect(String(dataset.PatientName)).toBe("FOX^JANE");
    expect(meta.MediaStorageSOPInstanceUID).toBe(dataset.SOPInstanceUID);

    const { bytes } = await DicomEventStream.fromPart10(buffer).toVideo();
    expect(bytes.byteLength).toBe(mp4.byteLength);
    expect(Array.from(bytes)).toEqual(Array.from(mp4));
});

test("fromVideo streams are re-runnable with stable identity", async () => {
    const events = DicomEventStream.fromVideo(makeTinyMp4());
    const naturalized = await events.toNaturalized();
    const { dataset } = readBack(await events.toPart10());
    expect(dataset.SOPInstanceUID).toBe(naturalized.SOPInstanceUID);
});

test("fromPdf → toPart10 → toPdf recovers the PDF byte-identically", async () => {
    // "%PDF-1.4\n%fake\n" — a tiny odd-length payload so the writer's
    // OB NUL pad is exercised and then trimmed on the way back out.
    const pdf = new Uint8Array([
        0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x66, 0x61,
        0x6b, 0x65, 0x0a
    ]);

    const buffer = await DicomEventStream.fromPdf(pdf, {
        PatientName: "DOE^JANE",
        DocumentTitle: "Discharge Summary"
    }).toPart10();

    const { dataset } = readBack(buffer);
    expect(dataset.SOPClassUID).toBe(ENCAPSULATED_PDF_SOP_CLASS_UID);
    expect(String(dataset.PatientName)).toBe("DOE^JANE");

    const { bytes, mimeType, title } = await DicomEventStream.fromPart10(
        buffer
    ).toPdf();
    expect(mimeType).toBe("application/pdf");
    expect(title).toBe("Discharge Summary");
    expect(Array.from(bytes)).toEqual(Array.from(pdf));
});

test("toPdf on a non-PDF stream throws the corrective error", async () => {
    const buffer = await DicomEventStream.fromImage({
        pixels: new Uint8Array(16),
        rows: 4,
        columns: 4
    }).toPart10();

    await expect(DicomEventStream.fromPart10(buffer).toPdf()).rejects.toThrow(
        new RegExp(ENCAPSULATED_PDF_SOP_CLASS_UID.replace(/\./g, "\\."))
    );
});
