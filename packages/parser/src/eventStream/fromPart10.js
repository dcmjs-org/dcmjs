import { fromPart10Stream } from "./fromPart10Stream.js";
export { emitValues, emitDecodedLeaf } from "./emit.js";

/**
 * fromPart10 — whole-buffer Part 10 bytes → event stream.
 *
 * A thin wrapper: the buffer is fed to the streaming reader as a single
 * chunk. Earlier drafts of the rewrite implemented this on a vendored
 * copy of the dicom-parser tokenizer; that package is removed from 1.0,
 * so the streaming reader's tokenizer is the only one in the library and
 * this wrapper keeps the buffered entry point working unchanged.
 *
 * @param {ArrayBuffer|ArrayBufferView} buffer - complete Part 10 bytes
 * @param {EventStreamListener} listener - the event consumer
 * @param {object} [options] - forwarded to fromPart10Stream
 */
export async function fromPart10(buffer, listener, options = {}) {
    const bytes =
        buffer instanceof Uint8Array
            ? buffer
            : ArrayBuffer.isView(buffer)
            ? new Uint8Array(
                  buffer.buffer,
                  buffer.byteOffset,
                  buffer.byteLength
              )
            : new Uint8Array(buffer);
    await fromPart10Stream(bytes, listener, options);
}
