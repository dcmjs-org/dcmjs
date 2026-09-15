import { createEventAsyncIterable } from "../../src/eventStream/asyncIterator";
import { fromDataSet } from "../../src/eventStream/fromDataSet";

const binBuf = new Uint8Array([9, 8, 7]).buffer;

const sampleDataset = {
    meta: { "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] } },
    dict: {
        "00100010": { vr: "PN", Value: ["Doe^Jane"] },
        "00081110": {
            vr: "SQ",
            Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
        },
        "7FE00010": { vr: "OB", Value: [binBuf] }
    }
};

describe("createEventAsyncIterable (pull adapter)", () => {
    test("yields the same event sequence the push core receives", async () => {
        const iterable = createEventAsyncIterable(listener =>
            fromDataSet(sampleDataset, listener)
        );

        const types = [];
        for await (const ev of iterable) {
            types.push(ev.type);
        }

        expect(types).toEqual([
            "startDataSet",
            "startFileMetaInformation",
            "startElement",
            "value",
            "endElement",
            "endFileMetaInformation",
            "startElement",
            "value",
            "endElement",
            "startSequence",
            "startItem",
            "startElement",
            "value",
            "endElement",
            "endItem",
            "endSequence",
            "startElement",
            "startBinary",
            "binaryFragment",
            "endBinary",
            "endElement",
            "endDataSet"
        ]);
    });

    test("carries event args (tag, payloads) on each event", async () => {
        const iterable = createEventAsyncIterable(listener =>
            fromDataSet(sampleDataset, listener)
        );
        const events = [];
        for await (const ev of iterable) {
            events.push(ev);
        }
        const values = events.filter(e => e.type === "value").map(e => e.args[0]);
        expect(values).toEqual(["1.2.840.10008.1.2.1", "Doe^Jane", "1.2.3"]);

        const frag = events.find(e => e.type === "binaryFragment");
        expect(frag.args[0]).toBe(binBuf);
    });

    test("propagates generator errors to the consumer", async () => {
        const boom = new Error("boom");
        const iterable = createEventAsyncIterable(() => Promise.reject(boom));
        await expect(
            (async () => {
                // eslint-disable-next-line no-unused-vars
                for await (const _ of iterable) {
                    /* drain */
                }
            })()
        ).rejects.toThrow("boom");
    });
});
