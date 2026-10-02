import { CollectorListener } from "./CollectorListener.js";
import { DicomDict } from "../DicomDict.js";

/**
 * Part10Writer — slice E2: an event-stream sink that produces DICOM Part 10
 * bytes.
 *
 * Architecture: this is a thin LAYER over the canonical encoder, not a second
 * encoder. It collects the event stream into a tag-keyed `{ meta, dict }` tree
 * (reusing CollectorListener) and delegates serialization to the proven
 * `DicomDict.write()`, which handles every VR, undefined-length sequences,
 * deflate, padding, Big16, and FileMetaInformationGroupLength recomputation.
 *
 * Byte-IDENTICAL Part 10 round-tripping (incl. re-emitting compressed pixel data
 * verbatim) is intentionally NOT this path's job — that is a non-goal of the
 * naturalized/event layer (spec §4.5) and remains served by the lazy-read +
 * R4 passthrough-write path. This writer produces correct, semantically faithful
 * Part 10 output from any event source.
 */
export class Part10Writer extends CollectorListener {
    /**
     * Serialize the collected dataset to a Part 10 ArrayBuffer.
     * @param {Object} [writeOptions] forwarded to DicomDict.write
     * @returns {ArrayBuffer}
     */
    write(writeOptions) {
        const meta = { ...this.result.meta };
        // DicomDict.write recomputes the group length; drop any collected one so
        // it is not double-counted.
        delete meta["00020000"];

        const dict = new DicomDict(meta);
        dict.dict = this.result.dict;
        return writeOptions ? dict.write(writeOptions) : dict.write();
    }
}
