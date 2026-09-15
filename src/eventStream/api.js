import { NaturalizedListener } from "./NaturalizedListener.js";
import { DicomWebJsonWriter } from "./DicomWebJsonWriter.js";
import { Part10Writer } from "./Part10Writer.js";
import { CollectorListener } from "./CollectorListener.js";
import { fromPart10 } from "./fromPart10.js";
import { fromPart10Stream } from "./fromPart10Stream.js";
import { fromDicomWebJson } from "./fromDicomWebJson.js";
import { fromDataSet } from "./fromDataSet.js";
import { createEventAsyncIterable } from "./asyncIterator.js";
import { buildImageDataset } from "../image/buildImageDataset.js";
import { datasetToDict } from "../datasetToBlob.js";
import { dicomDictFromFhir } from "./fromFhir.js";
import {
    encapsulatePdf,
    extractEncapsulatedPdf
} from "../encapsulated/encapsulatedPdf.js";
import { extractEncapsulatedVideo } from "../encapsulated/encapsulatedVideo.js";
import { createVideoEventSource } from "./fromVideo.js";
import { toFhir as mapToFhir } from "@dcmjs/fhir";

/**
 * The recommended public source/sink API (spec §32) — thin, ergonomic wrappers
 * over the event-stream generators and listeners.
 *
 *   const events = DicomEventStream.fromPart10(bytes);
 *   const metadata = await Naturalized.from(events);   // or events.toNaturalized()
 *   const json = await DicomWebJson.from(events);       // or events.toDicomWebJson()
 *
 * A DicomEventStream wraps a re-runnable `run(listener)` thunk, so the same
 * source can drive multiple sinks. Explicit listener usage remains available via
 * `events.process(listener)`.
 */
export class DicomEventStream {
    /**
     * @param {(listener: import("./EventStreamListener").EventStreamListener) => Promise<void>} run
     */
    constructor(run) {
        this._run = run;
    }

    /** A Part 10 byte buffer source. */
    static fromPart10(buffer, options = {}) {
        return new DicomEventStream(listener =>
            fromPart10(buffer, listener, options)
        );
    }

    /**
     * A chunked bytes→events source (slice K).
     *
     * Accepted `input` forms — see `fromPart10Stream` for the full contract:
     *   - `ArrayBuffer | Uint8Array`  → re-runnable (each `.process()` starts fresh)
     *   - `AsyncIterable | ReadableStream` → single-use; second `.process()` rejects
     *     with a clear "already been consumed" error.
     *
     * `noCopy` is not accepted; the streaming source forces noCopy off because
     * zero-copy views alias chunk memory that `consume()` releases (decision D-E).
     *
     * @param {ArrayBuffer|Uint8Array|AsyncIterable|ReadableStream} input
     * @param {Object} [options]
     * @param {boolean} [options.forceStoreRaw]
     * @param {boolean} [options.ignoreErrors]
     * @returns {DicomEventStream}
     */
    static fromPart10Stream(input, options = {}) {
        const isBuffer =
            input instanceof ArrayBuffer || ArrayBuffer.isView(input);

        if (isBuffer) {
            // Buffer inputs are re-runnable: every _run() creates a fresh parse.
            return new DicomEventStream(listener =>
                fromPart10Stream(input, listener, options)
            );
        }

        // Iterable / ReadableStream inputs are single-use: the iterator is
        // consumed on the first .process() call.  A second call rejects with
        // a clear error so callers are not silently handed an empty stream.
        let consumed = false;
        return new DicomEventStream(listener => {
            if (consumed) {
                return Promise.reject(
                    new Error(
                        "DicomEventStream.fromPart10Stream: this stream source " +
                            "has already been consumed and cannot be re-run. " +
                            "Only ArrayBuffer/Uint8Array inputs are re-runnable. " +
                            "To drive multiple sinks, convert the bytes to an " +
                            "ArrayBuffer first and pass that instead."
                    )
                );
            }
            consumed = true;
            return fromPart10Stream(input, listener, options);
        });
    }

    /** A DICOMweb JSON (DICOM JSON model) source. */
    static fromDicomWebJson(json) {
        return new DicomEventStream(listener =>
            fromDicomWebJson(json, listener)
        );
    }

    /** A parsed dcmjs dataset ({ meta, dict }) source. */
    static fromDataSet(dataset) {
        return new DicomEventStream(listener => fromDataSet(dataset, listener));
    }

    /**
     * An already-decoded image source: builds a full instance dataset via
     * image/buildImageDataset (geometry from the pixels, context from
     * options.metadata / keyword overrides, derived-instance conformance),
     * then streams it. The dataset is built eagerly so minted UIDs are
     * stable across re-runs of the same stream.
     *
     * @param {Object} decodedImage - { pixels, rows, columns, ... }
     * @param {Object} [options] - buildImageDataset options
     * @returns {DicomEventStream}
     */
    static fromImage(decodedImage, options = {}) {
        const dataset = buildImageDataset(decodedImage, options);
        const dicomDict = datasetToDict(dataset);
        if (options.encapsulated && dicomDict.dict["7FE00010"]) {
            // fromDataSet reads this flag to emit startBinary({encapsulated:true})
            dicomDict.dict["7FE00010"].encapsulatedPixelData = true;
        }
        return new DicomEventStream(listener =>
            fromDataSet(dicomDict, listener)
        );
    }

    /**
     * A content-carrying FHIR resource source: a DocumentReference or
     * Media whose attachment embeds inline data (or a Bundle holding one,
     * plus optionally a Patient for demographics). An embedded PDF becomes
     * an Encapsulated PDF instance; an embedded JPEG (the key-image case)
     * is carried verbatim as encapsulated PixelData — JPEG is a DICOM
     * transfer syntax, so only the frame header is read, never the pixels.
     * Context-only resources are rejected with corrective errors.
     *
     * @param {Object} resource - DocumentReference | Media | Bundle
     * @param {Object} [options] - { patient, overrides } (see fromFhir.js)
     * @returns {DicomEventStream}
     */
    static fromFhir(resource, options = {}) {
        const { dicomDict } = dicomDictFromFhir(resource, options);
        return new DicomEventStream(listener =>
            fromDataSet(dicomDict, listener)
        );
    }

    /**
     * A PDF source: wraps the bytes into an Encapsulated PDF instance
     * (encapsulatePdf) and streams it. Options are the encapsulatePdf
     * naturalized keyword overrides (PatientName, DocumentTitle,
     * StudyInstanceUID, ...).
     *
     * @param {ArrayBuffer|Uint8Array} pdfBytes
     * @param {Object} [options]
     * @returns {DicomEventStream}
     */
    static fromPdf(pdfBytes, options = {}) {
        const dicomDict = datasetToDict(encapsulatePdf(pdfBytes, options));
        return new DicomEventStream(listener =>
            fromDataSet(dicomDict, listener)
        );
    }

    /**
     * An MP4 video source, buffered (mirrors fromPdf): the H.264 stream is
     * carried verbatim as encapsulated PixelData in a Video Photographic
     * Image instance (Supplement 225) — geometry, frame count, and frame
     * rate are read from the MP4's moov metadata; no pixels are decoded.
     * The dataset is built eagerly so minted UIDs are stable across
     * re-runs. Unsupported codecs (anything but H.264 Baseline/Main/High
     * up to Level 4.2) throw a corrective error naming the transcode.
     *
     * @param {ArrayBuffer|Uint8Array} mp4Bytes
     * @param {Object} [options] - buildVideoDataset overrides (PatientName,
     *   StudyInstanceUID, ...) + { fragmentBytes }
     * @returns {DicomEventStream}
     */
    static fromVideo(mp4Bytes, options = {}) {
        const sourcePromise = createVideoEventSource(mp4Bytes, options);
        return new DicomEventStream(async listener =>
            (await sourcePromise).run(listener)
        );
    }

    /**
     * The streaming form of fromVideo, for MP4s too large to buffer: the
     * caller supplies a random-access reader and fragments are read one at
     * a time, so peak memory is one fragment regardless of file size. Pair
     * with StreamingPart10Writer for a bounded-memory MP4 → Part 10 write.
     *
     * @param {{size: number, read: (offset: number, length: number) =>
     *   Promise<Uint8Array>}} reader
     * @param {Object} [options] - as fromVideo
     * @returns {DicomEventStream}
     */
    static fromVideoStream(reader, options = {}) {
        const sourcePromise = createVideoEventSource(reader, options);
        return new DicomEventStream(async listener =>
            (await sourcePromise).run(listener)
        );
    }

    /**
     * Auto-detecting source factory: an ArrayBuffer/typed array is treated as
     * Part 10 bytes; an object with a `dict` (or `meta`) is a parsed dataset;
     * any other object is the DICOM JSON model.
     */
    static from(source) {
        if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
            return DicomEventStream.fromPart10(source);
        }
        if (source && typeof source === "object") {
            if (source.dict || source.meta) {
                return DicomEventStream.fromDataSet(source);
            }
            return DicomEventStream.fromDicomWebJson(source);
        }
        throw new TypeError(
            "DicomEventStream.from: unrecognized source (expected Part 10 bytes, a { meta, dict } dataset, or a DICOM JSON object)"
        );
    }

    /** Drive an arbitrary listener; resolves when the stream completes. */
    process(listener) {
        return Promise.resolve(this._run(listener)).then(() => listener);
    }

    /** Materialize the naturalized object (slice D1). */
    async toNaturalized(options = {}) {
        const listener = new NaturalizedListener(options);
        await this._run(listener);
        return listener.result;
    }

    /** Serialize to the DICOM JSON model (slice E1). */
    async toDicomWebJson() {
        const writer = new DicomWebJsonWriter();
        await this._run(writer);
        return writer.result;
    }

    /** Serialize to a Part 10 ArrayBuffer (slice E2). */
    async toPart10(writeOptions) {
        const writer = new Part10Writer();
        await this._run(writer);
        return writer.write(writeOptions);
    }

    /** Rebuild a tag-keyed { meta, dict } tree (the reference collector). */
    async toDataSet() {
        const collector = new CollectorListener();
        await this._run(collector);
        return collector.result;
    }

    /**
     * Map this instance to FHIR resources (@dcmjs/fhir toFhir over the
     * naturalized dataset): { patient, imagingStudy, documentReference }.
     * Covers ONE instance — aggregating a whole study into a single
     * ImagingStudy is a multi-stream operation: collect naturalized
     * datasets and use fhir.imagingStudyFromDatasets / fhir.toBundle.
     *
     * @param {Object} [options] - toFhir options (fhirVersion, subject, ...)
     */
    async toFhir(options = {}) {
        return mapToFhir(await this.toNaturalized(), options);
    }

    /**
     * Extract the embedded PDF from an Encapsulated PDF instance:
     * { bytes, mimeType, title }. Throws (naming the expected SOP class)
     * when the stream is not an Encapsulated PDF instance.
     */
    async toPdf() {
        return extractEncapsulatedPdf(await this.toNaturalized());
    }

    /**
     * Recover the verbatim video stream from an encapsulated video
     * instance: { bytes, transferSyntaxUID, declaredLength }. Fragments
     * are concatenated and truncated to the declared (7FE0,0003) total
     * length, so the result is byte-identical to the originally
     * encapsulated MP4. Buffered — for multi-GB instances stream the
     * fragments instead (see dcmjs-commands `convert --to mp4`). Throws a
     * corrective error when the stream is not a video instance.
     */
    async toVideo() {
        return extractEncapsulatedVideo(await this.toNaturalized());
    }

    /** Consume the stream as an async-iterable of `{ type, args }` events. */
    asyncIterable(options) {
        return createEventAsyncIterable(
            listener => this._run(listener),
            options
        );
    }
}

/** §32 sink helpers — `Naturalized.from(events)` / `DicomWebJson.from(events)`. */
export const Naturalized = {
    from(source, options) {
        return source.toNaturalized(options);
    }
};

export const DicomWebJson = {
    from(source) {
        return source.toDicomWebJson();
    }
};
