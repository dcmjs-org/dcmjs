import dcmjs from "../../src/index.js";

test("eventStream is exposed on the dcmjs namespace", () => {
    expect(dcmjs.eventStream).toBeDefined();
    expect(typeof dcmjs.eventStream.fromDataSet).toBe("function");
    expect(typeof dcmjs.eventStream.EventStreamListener).toBe("function");
    expect(typeof dcmjs.eventStream.createEventAsyncIterable).toBe("function");
    expect(dcmjs.eventStream.CONTRACT_VERSION).toBe("1.0.0-A");
});
