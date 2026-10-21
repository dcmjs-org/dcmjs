// packages/media/test/bundle.test.js
//
// The bundle adds no behavior: every name it re-exports must be the very
// same object as the underlying package's export (identity, not a copy or
// a wrapper), and the namespace shapes must match dcmjs v2's src/index.js.

import * as dicomdir from "@dcmjs-org/dicomdir";
import * as encapsulatedPackage from "@dcmjs-org/encapsulated";
import * as imaging from "@dcmjs-org/imaging";
import * as video from "@dcmjs-org/video";
import bundle, {
    media,
    encapsulated,
    image,
    createVideoEventSource
} from "../src/index.js";

/** Each name of `namespace` is the same object as the export of `source`. */
function expectSameExports(namespace, source, names) {
    for (const name of names) {
        expect(source[name]).toBeDefined();
        expect(namespace[name]).toBe(source[name]);
    }
}

test("media namespace re-exports the @dcmjs-org/dicomdir surface by identity", () => {
    expectSameExports(media, dicomdir, [
        "buildDicomDirDataset",
        "writeDicomDir",
        "MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID"
    ]);
});

test("encapsulated namespace re-exports the encapsulated and video surfaces by identity", () => {
    expectSameExports(encapsulated, encapsulatedPackage, [
        "encapsulate",
        "encapsulatedBase",
        "encapsulatePdf",
        "encapsulatedPdfBase",
        "extractEncapsulatedPdf",
        "ENCAPSULATED_PDF_SOP_CLASS_UID",
        "PDF_MIME_TYPE"
    ]);
    expectSameExports(encapsulated, video, [
        "buildVideoDataset",
        "videoBase",
        "encapsulateVideo",
        "extractEncapsulatedVideo",
        "VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID",
        "DEFAULT_FRAGMENT_BYTES"
    ]);
});

test("image namespace re-exports the imaging and MP4 surfaces by identity", () => {
    expectSameExports(image, imaging, [
        "buildImageDataset",
        "imageBase",
        "derivedImageBase",
        "SECONDARY_CAPTURE_SOP_CLASS_UID",
        "parseJpegInfo",
        "h264TransferSyntaxUID"
    ]);
    expectSameExports(image, video, ["parseMp4Info"]);
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
    const dataset = encapsulated.encapsulatePdf(pdfBytes, {
        overrides: { PatientName: "DOE^JANE" }
    });
    expect(dataset.SOPClassUID).toBe(
        encapsulated.ENCAPSULATED_PDF_SOP_CLASS_UID
    );
    expect(dataset.PatientName).toBe("DOE^JANE");
    const { bytes } = encapsulated.extractEncapsulatedPdf(dataset);
    expect(Array.from(new Uint8Array(bytes))).toEqual(Array.from(pdfBytes));
});
