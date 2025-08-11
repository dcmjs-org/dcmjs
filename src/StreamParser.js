import { ReadBufferStream } from "./BufferStream";
import { DicomMessage } from "./DicomMessage";
import {
    DEFLATED_EXPLICIT_LITTLE_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN
} from "./constants/dicom";
import { FmiHandler } from "./stream/FmiHandler";
import { TagHandler } from "./stream/TagHandler";
import { BodyHandler } from "./stream/BodyHandler";
import { Part10Handler } from "./stream/Part10Handler";

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
    /**
     * The handlers used for parsing various parts of the file stream
     */
    handlers = null;

    constructor(options = {}) {
        this.options = options;
        this.handlers = {
            fmi: new FmiHandler(this),
            tag: new TagHandler(this),
            tagBody: new BodyHandler(this),
            part10: new Part10Handler(this)
        };
    }

    initHandler(handler, parent = null) {
        return { handler, parent };
    }

    initPart10() {
        const stack = {
            options: this.options,
            tsuid: null,
            result: null,
            stream: new ReadBufferStream(),
            streamParser: this,
            top: this.initHandler(this.handlers.part10)
        };
        return stack;
    }

    append(stack, buffer) {
        stack.stream.addBuffer(buffer, { transfer: true });
    }

    parse(stack) {
        const { stream } = stack;
        while (!stream.complete || !stream.end()) {
            const { top } = stack;
            if (!top?.handler) {
                throw new Error(`stack top not defined: ${stack.top}`);
            }
            if (!top.handler.isSufficientLength(stack)) {
                return;
            }
            top.handler.parse(stack);
        }
        return stack.result;
    }

    setComplete(stack) {
        stack.stream.setComplete();
    }

    /**
     * Identifies the stream.
     * Returns the TSUID when the stream is understood/identified as the type of
     * the stream, and returns null when more data is still required for identification.
     */
    identifyStream(stack) {
        const { stream } = stack;
        if (stack.tsuid) {
            return stack.tsuid;
        }
        if (!this.stream.isAvailable(PART10_PREFIX_LENGTH)) {
            return;
        }

        if (stream.complete) {
            stack.tsuid = EXPLICIT_LITTLE_ENDIAN;
            return stack.tsuid;
        }

        stream.increment(128);
        if (stream.readAsciiString(4) !== "DICM") {
            stack.tsuid = EXPLICIT_LITTLE_ENDIAN;
            stream.reset();
            return stack.tsuid;
        }

        var el = DicomMessage._readTag(stream, stack.tsuid);
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
        stack.fmi = DicomMessage._read(
            metaStream,
            DEFLATED_EXPLICIT_LITTLE_ENDIAN,
            this.options
        );

        //get the syntax
        stack.tsuid = stack.fmi["00020010"].Value[0];

        if (!stack.tsuid) {
            throw new Error("Incoming stream doesn't have TSUID value");
        }

        stream.consume();

        //in case of deflated dataset, decompress and continue
        if (stack.tsuid === DEFLATED_EXPLICIT_LITTLE_ENDIAN) {
            // stream = new DeflatedReadBufferStream(stream, {
            //     noCopy: options.noCopy
            // });
            throw new Error("Deflated stream not yet supported");
        }

        return stack.tsuid;
    }
}
