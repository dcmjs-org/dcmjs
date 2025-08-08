/**
 * A part 10 handler knows how to recognize and parse DICOM part 10 files,
 * going through the three stages of prefix identification, FMI reading
 * and dicom body reading.
 */
export class Part10Handler {
    static PREFIX_SIZE = 128;
    static DICM_IDENTIFIER = "DICM";
    static DICM_SIZE = Part10Handler.DICM_IDENTIFIER.length;
    static PART10_IDENTIFIER_SIZE =
        Part10Handler.PREFIX_SIZE + Part10Handler.DICM_SIZE;

    constructor(streamParser) {
        this.streamParser = streamParser;
    }

    isSufficientLength(stream) {
        return stream.isAvailable(132) || stream.complete;
    }

    init() {
        return { parent: null, handler: this };
    }

    recognize(stream) {
        stream.increment(Part10Handler.PREFIX_SIZE);
        const isPart10 =
            stream.readAsciiString(Part10Handler.DICM_SIZE) ===
            Part10Handler.DICM_IDENTIFIER;
        stream.reset();
        return isPart10;
    }

    parse(stack) {
        const { stream } = stack;
        stream.increment(Part10Handler.PREFIX_SIZE);
        const identifier = stream.readAsciiString(Part10Handler.DICM_SIZE);
        if (identifier !== Part10Handler.DICM_IDENTIFIER) {
            throw new Error(`Incorrect identifier: ${identifier}`);
        }
        stack.top = this.streamParser.initHandler(
            this.streamParser.handlers.fmi
        );
        console.warn("Assigning stack top", stack.top.handler);
    }
}
