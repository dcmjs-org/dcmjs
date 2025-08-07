import { DicomMessage } from "../DicomMessage";
import { BodyHandler } from "./BodyHandler";

export class TagHandler {
    static defaultHandler = new BodyHandler();

    constructor(options) {
        this.options = options;
    }

    /**
     * Indicates if the stream currently has enough data to continue parsing.
     */
    isSufficientLength(stream) {
        return stream.isAvailble(12) || stream.complete;
    }

    /**
     * Continues parsing.  This will check the next tag value, reading it
     * up the end of the tag information.
     * Then, the first tag handler matching the tag body to return will
     * get called as the initTag method on it and the current stream.
     */
    continueParsing(stream, stack) {
        if (stream.complete) {
            stack.pop();
            return this.body;
        }

        const header = DicomMessage._readTagHeader(
            stream,
            this.syntax,
            this.options
        );

        const handler = this.getHandler(header, stream, stack);
        handler.init(header, stream, stack, this.options);
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
