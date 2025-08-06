import { ReadBufferStream } from "./BufferStream";
import { EXPLICIT_LITTLE_ENDIAN } from "./constants/dicom";

const PART10_PREFIX_LENGTH = 140;

/**
 * A stream parser uses a deliver method to add more data to the input stream,
 * clearing data as it gets read and progressively adding data to a dicom
 * object.
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
    pop() {

    }

    createTag(tag,vr,length) {

    }

    /** Delivers data from the tag body to the current tag handler */
    tagData(buffer, start=0, length=buffer.byteLength) {

    }

    push(childStack) {

    }

    /**
     * Continues parsing the stream for more DICOM data.
     * 
     */
    parse(options=null) {

    }

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
        
        if( !this.tsuid ) {
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
