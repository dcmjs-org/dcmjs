import { EventStreamListener } from "../../src/eventStream/EventStreamListener";

describe("EventStreamListener push core", () => {
    test("dispatches the full vocabulary through a filter's next chain", () => {
        const calls = [];
        const recorder = {
            startElement(next, tag, info) {
                calls.push(["startElement", tag, info?.vr]);
                return next(tag, info);
            },
            value(next, v) {
                calls.push(["value", v]);
                return next(v);
            },
            startSequence(next, tag, info) {
                calls.push(["startSequence", tag]);
                return next(tag, info);
            },
            startItem(next, info) {
                calls.push(["startItem"]);
                return next(info);
            }
        };

        const listener = new EventStreamListener(recorder);

        listener.startSequence("00081110", { vr: "SQ" });
        listener.startItem({ length: 0 });
        listener.startElement("00081150", { vr: "UI" });
        listener.value("1.2.3");
        listener.endElement();
        listener.endItem();
        listener.endSequence();

        expect(calls).toEqual([
            ["startSequence", "00081110"],
            ["startItem"],
            ["startElement", "00081150", "UI"],
            ["value", "1.2.3"]
        ]);
    });

    test("exposes every contract method", () => {
        const listener = new EventStreamListener();
        const vocab = [
            "startDataSet",
            "endDataSet",
            "startFileMetaInformation",
            "endFileMetaInformation",
            "startElement",
            "endElement",
            "startSequence",
            "endSequence",
            "startItem",
            "endItem",
            "value",
            "bulkDataReference",
            "startBinary",
            "binaryFragment",
            "endBinary"
        ];
        for (const name of vocab) {
            expect(typeof listener[name]).toBe("function");
        }
    });

    test("awaitDrain resolves immediately when no drain is set", async () => {
        const listener = new EventStreamListener();
        await expect(listener.awaitDrain()).resolves.toBeUndefined();
    });

    test("setDrain installs a backpressure gate that awaitDrain awaits", async () => {
        const listener = new EventStreamListener();
        let released;
        const gate = new Promise(resolve => {
            released = resolve;
        });
        let drained = false;
        listener.setDrain(() => gate);

        const waiting = listener.awaitDrain().then(() => {
            drained = true;
        });
        expect(drained).toBe(false);
        released();
        await waiting;
        expect(drained).toBe(true);
    });
});
