import { fromDicomWebJson } from "../../src/eventStream/fromDicomWebJson";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { CollectorListener } from "../../src/eventStream/CollectorListener";
import { EventStreamListener } from "../../src/eventStream/EventStreamListener";

/** Records (type, tag?) of each event for structural comparison. */
function recorder() {
    const calls = [];
    const tap = name => ({
        [name](next, ...args) {
            calls.push([name, ...args]);
            return next(...args);
        }
    });
    const listener = new EventStreamListener(
        tap("startElement"),
        tap("startSequence"),
        tap("startItem"),
        tap("endItem"),
        tap("endSequence"),
        tap("endElement"),
        tap("value"),
        tap("startBinary"),
        tap("binaryFragment"),
        tap("endBinary"),
        tap("bulkDataReference")
    );
    listener.calls = calls;
    return listener;
}

describe("fromDicomWebJson generator", () => {
    test("emits scalars, PN-as-{Alphabetic}, and sequences losslessly", async () => {
        const json = {
            "00080060": { vr: "CS", Value: ["CT"] },
            "00100010": { vr: "PN", Value: [{ Alphabetic: "Doe^Jane" }] },
            "00100020": { vr: "LO", Value: ["12345"] },
            "00200013": { vr: "IS", Value: [12] },
            "00081110": {
                vr: "SQ",
                Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
            }
        };
        const listener = new CollectorListener();
        await fromDicomWebJson(json, listener);

        expect(listener.result.dict).toEqual({
            "00080060": { vr: "CS", Value: ["CT"] },
            "00100010": { vr: "PN", Value: [{ Alphabetic: "Doe^Jane" }] },
            "00100020": { vr: "LO", Value: ["12345"] },
            "00200013": { vr: "IS", Value: [12] },
            "00081110": {
                vr: "SQ",
                Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
            }
        });
    });

    test("maps BulkDataURI to a bulkDataReference value", async () => {
        const json = {
            "7FE00010": { vr: "OB", BulkDataURI: "https://s/bulk/1" }
        };
        const listener = new CollectorListener();
        await fromDicomWebJson(json, listener);
        expect(listener.result.dict["7FE00010"].Value).toEqual([
            { BulkDataURI: "https://s/bulk/1" }
        ]);
    });

    test("decodes InlineBinary base64 into a buffer fragment (§22)", async () => {
        // base64 "AQIDBA==" === bytes [1,2,3,4]
        const json = {
            "7FE00010": { vr: "OB", InlineBinary: "AQIDBA==" }
        };
        const listener = new CollectorListener();
        await fromDicomWebJson(json, listener);
        const value = listener.result.dict["7FE00010"].Value;
        expect(value).toHaveLength(1);
        expect(Array.from(new Uint8Array(value[0]))).toEqual([1, 2, 3, 4]);
    });

    test("awaits backpressure at top-level element boundaries", async () => {
        const json = { "00100020": { vr: "LO", Value: ["1"] } };
        const listener = new CollectorListener();
        let asked = false;
        listener.setDrain(() => {
            asked = true;
            return Promise.resolve();
        });
        await fromDicomWebJson(json, listener);
        expect(asked).toBe(true);
    });
});

describe("source-agnostic: DICOMweb JSON and dcmjs dict produce equivalent structure", () => {
    test("same dataset yields the same event/tag structure (PN value aside)", async () => {
        const jsonSource = {
            "00080060": { vr: "CS", Value: ["CT"] },
            "00200013": { vr: "IS", Value: [12] },
            "00081110": {
                vr: "SQ",
                Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
            }
        };
        const dictSource = {
            dict: {
                "00080060": { vr: "CS", Value: ["CT"] },
                "00200013": { vr: "IS", Value: [12] },
                "00081110": {
                    vr: "SQ",
                    Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
                }
            }
        };

        const jsonRec = recorder();
        await fromDicomWebJson(jsonSource, jsonRec);
        const dictRec = recorder();
        await fromDataSet(dictSource, dictRec);

        const shape = calls =>
            calls.map(c =>
                c[0] === "startElement" || c[0] === "startSequence"
                    ? [c[0], c[1]]
                    : [c[0], c[1] !== undefined ? c[1] : null]
            );
        expect(shape(jsonRec.calls)).toEqual(shape(dictRec.calls));
    });
});
