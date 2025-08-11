import { DicomMessage } from "../DicomMessage";
import { BodyHandler } from "./BodyHandler";

/**
 * Handles the creation of the tag header values
 */
export class TagHandler {
    static defaultHandler = new BodyHandler();

    constructor(options) {
        this.options = options;
    }

    /**
     * Indicates if the stream currently has enough data to continue parsing.
     */
    isSufficientLength({ stream }) {
        return stream.isAvailable(16) || stream.complete;
    }

    /**
     * Continues parsing.  This will check the next tag value, reading it
     * up the end of the tag information.
     * Then, the first tag handler matching the tag body to return will
     * get called as the initTag method on it and the current stream.
     */
    parse(stack) {
        const { stream } = stack;

        const header = DicomMessage._readTagHeader(
            stream,
            this.syntax,
            this.options
        );

        console.warn("tag header=", header.tag.toString(), header.tag.length);

        // Cases to handle:
        //   4 Undefined length pixel data handler
        //   3 Defined length Pixel Data
        //   5 Bulk data - check if it is bulk applicable and switch to bulk handler
        //   2 SQ - switch to sequence generation as child
        //   1 Use TagBody handler

        stack.top = this.streamParser.initHandler(
            this.streamParser.handlers.tag
        );
    }

    getHandler(header) {
        for (const handler of this.handlers) {
            if (handler.canHandle(this, header)) {
                return handler;
            }
        }
        return this.constructor.defaultHandler;
    }
}
