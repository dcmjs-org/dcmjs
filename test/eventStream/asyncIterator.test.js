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
        const values = events
            .filter(e => e.type === "value")
            .map(e => e.args[0]);
        expect(values).toEqual(["1.2.840.10008.1.2.1", "Doe^Jane", "1.2.3"]);

        const frag = events.find(e => e.type === "binaryFragment");
        expect(frag.args[0]).toBe(binBuf);
    });

    test("break out of for-await releases a suspended producer (review finding 13)", async () => {
        // Enough top-level elements that the producer suspends in its drain
        // gate with the queue full once the consumer stops reading.
        const dict = {};
        for (let i = 0; i < 50; i++) {
            const element = (0x1000 + i)
                .toString(16)
                .padStart(4, "0")
                .toUpperCase();
            dict[`0009${element}`] = { vr: "LO", Value: [`v${i}`] };
        }
        let producerSettled = false;
        const iterable = createEventAsyncIterable(
            listener =>
                fromDataSet({ meta: {}, dict }, listener).finally(() => {
                    producerSettled = true;
                }),
            { highWaterMark: 2 }
        );

        for await (const ev of iterable) {
            void ev;
            break;
        }

        // The cancellation propagates through the rejected drain promise;
        // give the producer a few turns to unwind.
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(producerSettled).toBe(true);
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
