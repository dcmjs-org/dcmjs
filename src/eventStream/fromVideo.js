// src/eventStream/fromVideo.js
//
// MP4 → event stream (Supplement 225 video encapsulation). The dataset shell
// is built eagerly (stable UIDs across re-runs, like fromImage); running the
// stream replays the shell, then emits the MP4 as encapsulated PixelData
// fragments read one at a time from a random-access reader — so a 21.8 GB
// file streams with at most one fragment in memory, and the same code path
// serves in-memory bytes.
//
// The natural sink is StreamingPart10Writer, which turns each binaryFragment
// into one fragment item (undefined-length OB, empty Basic Offset Table,
// even-padded items, sequence delimiter). Backpressure is honored between
// fragments via listener.awaitDrain().

import { datasetToDict } from "../datasetToBlob.js";
import { fromDataSet } from "./fromDataSet.js";
import { parseMp4Info } from "../image/mp4Info.js";
import {
    buildVideoDataset,
    normalizeFragmentBytes
} from "../encapsulated/encapsulatedVideo.js";
import { EVENT_STREAM_VOCABULARY } from "./EventStreamListener.js";

const PIXEL_DATA_TAG = "7FE00010";

/** Wrap in-memory bytes in the random-access reader contract. */
function memoryReader(input) {
    const bytes =
        input instanceof ArrayBuffer
            ? new Uint8Array(input)
            : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return {
        size: bytes.byteLength,
        read: (offset, length) =>
            Promise.resolve(bytes.subarray(offset, offset + length))
    };
}

/**
 * Fragments must reach buffered sinks as EXACT buffers: the collector →
 * DicomDict.write path resolves a typed-array view to its whole backing
 * ArrayBuffer (byteOffset is lost), so a subarray view would serialize the
 * wrong bytes. Views that already span their full backing buffer (the
 * fd-read case in streaming CLIs) pass through copy-free.
 */
function exactFragment(fragment) {
    if (
        ArrayBuffer.isView(fragment) &&
        (fragment.byteOffset !== 0 ||
            fragment.byteLength !== fragment.buffer.byteLength)
    ) {
        return fragment.buffer.slice(
            fragment.byteOffset,
            fragment.byteOffset + fragment.byteLength
        );
    }
    return fragment;
}

/**
 * A forwarding view of `listener` that swallows endDataSet, so the dataset
 * shell can be replayed first and the stream closed only after the pixel
 * data fragments. awaitDrain/setDrain forward too — backpressure must
 * survive the wrapper or the shell replay would run ungated.
 */
function withoutEndDataSet(listener) {
    const wrapper = {};
    for (const method of EVENT_STREAM_VOCABULARY) {
        wrapper[method] = (...args) => listener[method](...args);
    }
    wrapper.endDataSet = () => {};
    wrapper.awaitDrain = () => listener.awaitDrain();
    wrapper.setDrain = fn => listener.setDrain(fn);
    return wrapper;
}

/**
 * Rebuild a dict with its tags in ascending order. fromDataSet emits entries
 * in key order and StreamingPart10Writer writes them as they arrive, so key
 * order IS file order; naturalized→denaturalized dicts follow property
 * insertion order, which need not be tag order. Fixed-width uppercase hex
 * sorts lexicographically === numerically.
 */
function sortDict(dict) {
    const sorted = {};
    for (const tag of Object.keys(dict).sort()) {
        sorted[tag] = dict[tag];
    }
    return sorted;
}

/**
 * Create the video event source.
 *
 * @param {Uint8Array|ArrayBuffer|{size, read(offset, length)}} input - MP4
 *   bytes or a random-access reader over them
 * @param {Object} [options] - buildVideoDataset overrides + { fragmentBytes }
 * @returns {Promise<{ run: (listener) => Promise<void>, info: Object,
 *   dataset: Object }>}
 */
export async function createVideoEventSource(input, options = {}) {
    const reader =
        input instanceof ArrayBuffer || ArrayBuffer.isView(input)
            ? memoryReader(input)
            : input;
    const info = await parseMp4Info(reader);
    const dataset = buildVideoDataset(info, options);
    const fragmentBytes = normalizeFragmentBytes(options.fragmentBytes);

    const dicomDict = datasetToDict(dataset);
    dicomDict.dict = sortDict(dicomDict.dict);

    async function run(listener) {
        await fromDataSet(dicomDict, withoutEndDataSet(listener));

        listener.startElement(PIXEL_DATA_TAG, { vr: "OB", length: -1 });
        listener.startBinary({ encapsulated: true });
        for (let offset = 0; offset < reader.size; offset += fragmentBytes) {
            const length = Math.min(fragmentBytes, reader.size - offset);
            listener.binaryFragment(
                exactFragment(await reader.read(offset, length))
            );
            // The defined backpressure checkpoint between fragments.
            await listener.awaitDrain();
        }
        listener.endBinary();
        listener.endElement();
        listener.endDataSet();
    }

    return { run, info, dataset };
}
