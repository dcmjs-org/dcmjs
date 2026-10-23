import dcmjs from "../../src/index.js";
import eventStream from "../../src/eventStream.js";

test("eventStream is the @dcmjs-org/dcmjs/eventStream subpath", () => {
    expect(dcmjs.eventStream).toBeUndefined();
    expect(typeof eventStream.fromDataSet).toBe("function");
    expect(typeof eventStream.EventStreamListener).toBe("function");
    expect(typeof eventStream.createEventAsyncIterable).toBe("function");
    expect(typeof eventStream.DicomEventStream).toBe("function");
    expect(eventStream.CONTRACT_VERSION).toBe("1.0.0-A");
});
