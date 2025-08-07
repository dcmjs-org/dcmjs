import { ReadBufferStream } from "./BufferStream";
import { EXPLICIT_LITTLE_ENDIAN } from "./constants/dicom";

const PART10_PREFIX_LENGTH = 140;

/**
 * A stream parser uses a deliver method to add more data to the input stream,
 * clearing data as it gets read and progressively adding data to a dicom
 * object.
 *
 * Basic behaviour:
 *   * Start with tag handler on empty object
 *   * Tag handler expects at least 12 bytes or EOF
 *   * Tag handler reads length/vr/tag value and creates Tag Body Handler
 *
 * Tag Body Handler - fixed length
 *    * Read fixed size blocks as it becomes available, append to overall block handler
 *
 * Sequence Tag Body Handler - Create sequence child item and start delivering item/end blocks to it
 *    * When item block delivered, deliver a Tag Body Handler, set to return on end item
 *
 * Fixed Pixel Data Handler
 *    * Figure out image size, wait for blocks of given size and unpack
 *
 * Compressed Pixel Data Handler
 *    * For single frame, deliver frame blocks to handler to create combined array data
 *    * For multi frame, deliver each block to handler (TODO - check if JPEG continuation)
 *         (TODO, check offsets)
 *
 * BulkData handler - single tag fixed length handler which writes bulkdata to files
 *     * Takes existing object to figure out name type, OR uses hash blocks
 *     * Throws away data once read
 *
 * Naturalized Handler - replacement for tag handler which writes naturalized data direct
 * Study Tree Handler - naturalized handler variant that writes to study tree directly, dedupping en route
 *
 * body handlers basically have a list of available handlers, first one claiming to handle it gets it.
 *
 * Tag handler calls the body handler for figuring out which one to apply (decides which one to call)
 *
 * DICM handler - checks the DICM indicator, expecting EOF or the dicom prefix.
 *
 * FMI Handler - reads the FMI prefix data
 *
 */
export class StreamParser {
    stream = null;

    fmi = null;

    tsuid = "";

    constructor(options) {
        stream = new ReadBufferStream();
    }

    /**
     * Causes the read stack to be popped so that the next parent element
     * can be appended to instead of this one.
     */
    pop() {}

    createTag(tag, vr, length) {}

    /** Delivers data from the tag body to the current tag handler */
    tagData(buffer, start = 0, length = buffer.byteLength) {}

    push(childStack) {}

    /**
     * Continues parsing the stream for more DICOM data.
     *
     */
    parse(options = null) {}

    /**
     * Identifies the stream.
     * Returns the TSUID when the stream is understood/identified as the type of
     * the stream, and returns null when more data is still required for identification.
     */
    identifyStream() {
        const { stream } = this;
        if (this.tsuid) {
            return this.tsuid;
        }
        if (!this.stream.isAvailable(PART10_PREFIX_LENGTH)) {
            return;
        }

        if (stream.complete) {
            this.tsuid = EXPLICIT_LITTLE_ENDIAN;
            return this.tsuid;
        }

        stream.increment(128);
        if (stream.readAsciiString(4) !== "DICM") {
            this.tsuid = EXPLICIT_LITTLE_ENDIAN;
            stream.reset();
            return this.tsuid;
        }

        var el = DicomMessage._readTag(stream, useSyntax);
        if (el.tag.toCleanString() !== "00020000") {
            throw new Error(
                "Invalid DICOM file, meta length tag is malformed or not present."
            );
        }
        console.warn("After header setup, stream length is:", this.offset);
        var metaLength = el.values[0];

        if (!stream.isAvailable(metaLength)) {
            if (stream.complete) {
                throw new Error(
                    `Unexpected EOL at ${stream.offset} while ready header`
                );
            }
            stream.reset;
            return;
        }

        //read header buffer
        const metaStream = stream.more(metaLength);
        this.fmi = DicomMessage._read(metaStream, useSyntax, options);

        //get the syntax
        this.tsuid = metaHeader["00020010"].Value[0];

        if (!this.tsuid) {
            throw new Error("Incoming stream doesn't have TSUID value");
        }

        stream.consume();

        //in case of deflated dataset, decompress and continue
        if (mainSyntax === DEFLATED_EXPLICIT_LITTLE_ENDIAN) {
            // stream = new DeflatedReadBufferStream(stream, {
            //     noCopy: options.noCopy
            // });
            throw new Error("Deflated stream not yet supported");
        }

        return this.tsuid;
    }
}
