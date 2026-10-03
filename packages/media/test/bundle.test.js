// packages/media/test/bundle.test.js
//
// The bundle adds no behavior: every name it re-exports must be the very
// same object as the underlying package's export (identity, not a copy or
// a wrapper), and the namespace shapes must match dcmjs v2's src/index.js.

import * as dicomdir from "@dcmjs-org/dicomdir";
import * as pdfs from "@dcmjs-org/pdfs";
import * as video from "@dcmjs-org/video";
import bundle, {
    media,
    encapsulated,
    image,
    createVideoEventSource
} from "../src/index.js";

test("media namespace re-exports the @dcmjs-org/dicomdir surface by identity", () => {
    expect(media.buildDicomDirDataset).toBe(dicomdir.buildDicomDirDataset);
    expect(media.writeDicomDir).toBe(dicomdir.writeDicomDir);
    expect(media.MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID).toBe(
        dicomdir.MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID
    );
});

test("encapsulated namespace re-exports the pdfs and video surfaces by identity", () => {
    expect(encapsulated.encapsulatePdf).toBe(pdfs.encapsulatePdf);
    expect(encapsulated.extractEncapsulatedPdf).toBe(
        pdfs.extractEncapsulatedPdf
    );
    expect(encapsulated.ENCAPSULATED_PDF_SOP_CLASS_UID).toBe(
        pdfs.ENCAPSULATED_PDF_SOP_CLASS_UID
    );
    expect(encapsulated.buildVideoDataset).toBe(video.buildVideoDataset);
    expect(encapsulated.encapsulateVideo).toBe(video.encapsulateVideo);
    expect(encapsulated.extractEncapsulatedVideo).toBe(
        video.extractEncapsulatedVideo
    );
    expect(encapsulated.normalizeFragmentBytes).toBe(
        video.normalizeFragmentBytes
    );
    expect(encapsulated.VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID).toBe(
        video.VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID
    );
    expect(encapsulated.DEFAULT_FRAGMENT_BYTES).toBe(
        video.DEFAULT_FRAGMENT_BYTES
    );
});

test("image namespace re-exports the @dcmjs-org/video image surface by identity", () => {
    expect(image.buildImageDataset).toBe(video.buildImageDataset);
    expect(image.SECONDARY_CAPTURE_SOP_CLASS_UID).toBe(
        video.SECONDARY_CAPTURE_SOP_CLASS_UID
    );
    expect(image.parseJpegInfo).toBe(video.parseJpegInfo);
    expect(image.parseMp4Info).toBe(video.parseMp4Info);
    expect(image.h264TransferSyntaxUID).toBe(video.h264TransferSyntaxUID);
});

test("the streaming video source and the default export ride along", () => {
    expect(createVideoEventSource).toBe(video.createVideoEventSource);
    expect(bundle.media).toBe(media);
    expect(bundle.encapsulated).toBe(encapsulated);
    expect(bundle.image).toBe(image);
    expect(bundle.createVideoEventSource).toBe(createVideoEventSource);
});

test("a re-exported builder actually works through the bundle", () => {
    const pdfBytes = new Uint8Array([
        0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34
    ]); // "%PDF-1.4"
    const dataset = encapsulated.encapsulatePdf(pdfBytes);
    expect(dataset.SOPClassUID).toBe(
        encapsulated.ENCAPSULATED_PDF_SOP_CLASS_UID
    );
    const { bytes } = encapsulated.extractEncapsulatedPdf(dataset);
    expect(Array.from(new Uint8Array(bytes))).toEqual(Array.from(pdfBytes));
});
