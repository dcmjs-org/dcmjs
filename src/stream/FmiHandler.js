import {
    DEFLATED_EXPLICIT_LITTLE_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN
} from "../constants/dicom.js";

import { DicomMessage } from "../DicomMessage.js";

export class FmiHandler {
    constructor(streamParser) {
        this.streamParser = streamParser;
    }

    isSufficientLength(stack) {
        console.warn("stack=", stack.top);
        const { stream, top } = stack;
        if (top.tag?.values.length) {
            return stream.isAvailable(top.tag.values[0]) || stream.complete;
        }
        return stream.isAvailable(16) || stream.complete;
    }

    init() {
        return { parent: null, handler: this };
    }

    parse(stack) {
        const { stream, top, options } = stack;
        let { tag } = top;
        if (!tag) {
            tag = DicomMessage._readTagHeader(
                stream,
                EXPLICIT_LITTLE_ENDIAN,
                options
            );
            if (tag.tag.toCleanString() !== "00020000") {
                throw new Error(
                    `TODO - handle parsing non compliant streams: ${tag.tag}`
                );
            }
            DicomMessage._readTagBody(
                tag,
                stream,
                EXPLICIT_LITTLE_ENDIAN,
                options
            );
            console.warn("Read tag body", tag.tag, tag.length);
        }
        const [metaLength] = tag.retObj.values;
        console.warn("Parsing FMI stream", metaLength);
        if (!stream.isAvailable(metaLength) && !stream.complete) {
            return;
        }
        const metaStream = stream.more(metaLength);
        const metaHeader = DicomMessage._read(
            metaStream,
            EXPLICIT_LITTLE_ENDIAN,
            options
        );

        stack.metaHeader = metaHeader;
        stack.tsuid = metaHeader["00020010"].Value[0];
        if (stack.tsuid === DEFLATED_EXPLICIT_LITTLE_ENDIAN) {
            throw new Error("Unsupported syntax: compressed " + stack.tsuid);
        }
        stack.top = this.streamParser.initHandler(
            this.streamParser.handlers.tag
        );
        stack.dict = {};
        stack.top.dict = stack.dict;
    }
}
