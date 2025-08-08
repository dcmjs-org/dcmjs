export class FmiHandler {
    constructor(streamParser) {
        this.streamParser = streamParser;
    }

    isSufficientLength(stream) {
        return stream.isAvailable(1024 * 10) || stream.complete;
    }

    init() {
        return { parent: null, handler: this };
    }

    parse(_stream) {
        console.warn("Parsing FMI stream");
        throw new Error("TODO - implement FMI");
    }
}
