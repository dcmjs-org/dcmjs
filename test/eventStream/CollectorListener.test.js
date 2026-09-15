import { CollectorListener } from "../../src/eventStream/CollectorListener";

/** Drive a listener through a hand-written event sequence. */
function drive(listener) {
    listener.startDataSet({ transferSyntaxUID: "1.2.840.10008.1.2.1" });

    listener.startFileMetaInformation();
    listener.startElement("00020010", { vr: "UI" });
    listener.value("1.2.840.10008.1.2.1");
    listener.endElement();
    listener.endFileMetaInformation();

    // A plain scalar
    listener.startElement("00100010", { vr: "PN" });
    listener.value("Doe^Jane");
    listener.endElement();

    // A sequence with one item containing one element
    listener.startSequence("00081110", { vr: "SQ" });
    listener.startItem({ length: 0 });
    listener.startElement("00081150", { vr: "UI" });
    listener.value("1.2.3");
    listener.endElement();
    listener.endItem();
    listener.endSequence();

    listener.endDataSet();
}

describe("CollectorListener", () => {
    test("rebuilds a {meta, dict} tree matching the dcmjs parse shape", () => {
        const listener = new CollectorListener();
        drive(listener);

        expect(listener.result).toEqual({
            meta: {
                "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] }
            },
            dict: {
                "00100010": { vr: "PN", Value: ["Doe^Jane"] },
                "00081110": {
                    vr: "SQ",
                    Value: [
                        { "00081150": { vr: "UI", Value: ["1.2.3"] } }
                    ]
                }
            }
        });
    });

    test("collects binary fragments as separate Value entries, preserving boundaries", () => {
        const listener = new CollectorListener();
        const f1 = new Uint8Array([1, 2]).buffer;
        const f2 = new Uint8Array([3, 4, 5]).buffer;

        listener.startDataSet({});
        listener.startElement("7FE00010", { vr: "OB" });
        listener.startBinary({ encapsulated: true });
        listener.binaryFragment(f1);
        listener.binaryFragment(f2);
        listener.endBinary();
        listener.endElement();
        listener.endDataSet();

        expect(listener.result.dict["7FE00010"].Value).toEqual([f1, f2]);
    });

    test("represents bulkDataReference as a {BulkDataURI} value", () => {
        const listener = new CollectorListener();
        listener.startDataSet({});
        listener.startElement("7FE00010", { vr: "OB" });
        listener.bulkDataReference({ uri: "../bulk/1" });
        listener.endElement();
        listener.endDataSet();

        expect(listener.result.dict["7FE00010"].Value).toEqual([
            { BulkDataURI: "../bulk/1" }
        ]);
    });
});
