/**
 * Private reserved blocks in the naturalized form (PS3.5 7.8.1): both
 * naturalizers give the same `${group}:${creator}` blocks, and every write
 * path undoes them. See packages/core/src/utilities/privateBlocks.js.
 */
import dcmjs from "../../src/index.js";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { fromNaturalized } from "../../src/eventStream/fromNaturalized";
import { Part10Writer } from "../../src/eventStream/Part10Writer";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

// Two groups with the same creator at the same xx, a creator listed after
// its data, a private element without a creator, and a sequence item.
function sourceDict() {
    return {
        "00100020": { vr: "LO", Value: ["PID"] },
        "00091001": { vr: "LO", Value: ["nine"] },
        "00090010": { vr: "LO", Value: ["ACME"] },
        "00290010": { vr: "LO", Value: ["ACME"] },
        "00291001": { vr: "US", Value: [7] },
        "00291102": { vr: "LO", Value: ["orphan"] },
        "00400100": {
            vr: "SQ",
            Value: [
                {
                    "00290010": { vr: "LO", Value: ["ITEM"] },
                    "00291005": { vr: "LO", Value: ["in-item"] }
                }
            ]
        }
    };
}

async function listenerNaturalize(dict) {
    const listener = new NaturalizedListener();
    await fromDataSet({ dict }, listener);
    return listener.result;
}

describe("private reserved blocks", () => {
    it("naturalizeDataset and NaturalizedListener give the same object", async () => {
        const fromDict = DicomMetaDictionary.naturalizeDataset(sourceDict());
        const fromEvents = await listenerNaturalize(sourceDict());

        expect(fromEvents).toEqual(fromDict);
        expect(fromDict["0009:ACME"]).toEqual({
            creator: "ACME",
            reservedBlock: 0x10,
            x01: "nine"
        });
        expect(fromDict["0029:ACME"]).toEqual({
            creator: "ACME",
            reservedBlock: 0x10,
            x01: 7
        });
        expect(fromDict._vrMap["0029:ACME"]).toEqual({ x01: "US" });
        expect(fromDict["00291102"]).toBe("orphan");
        expect(fromDict.ScheduledProcedureStepSequence["0029:ITEM"].x05).toBe(
            "in-item"
        );
        for (const naturalized of [fromDict, fromEvents]) {
            expect(naturalized["00291001"]).toBe(7);
            expect(naturalized["00090010"]).toBe("ACME");
        }
    });

    it("a hex alias writes through to its block", () => {
        const naturalized = DicomMetaDictionary.naturalizeDataset(sourceDict());
        naturalized["00291001"] = 9;
        expect(naturalized["0029:ACME"].x01).toBe(9);
        const dict = DicomMetaDictionary.denaturalizeDataset(naturalized);
        expect(Number(dict["00291001"].Value[0])).toBe(9);
    });

    it("denaturalize keeps a free reservedBlock and moves a taken one", () => {
        const dict = DicomMetaDictionary.denaturalizeDataset({
            _vrMap: {
                "00290010": "LO",
                "00291010": "LO",
                "0029:MOVED": { x01: "LO" },
                "0029:KEPT": { x01: "LO" }
            },
            "00290010": "OLD FORM",
            "00291010": "flat",
            "0029:MOVED": { creator: "MOVED", reservedBlock: 0x10, x01: "m" },
            "0029:KEPT": { creator: "KEPT", reservedBlock: 0x12, x01: "k" }
        });

        expect(dict["00290010"].Value).toEqual(["OLD FORM"]);
        expect(dict["00291010"].Value).toEqual(["flat"]);
        expect(dict["00290012"].Value).toEqual(["KEPT"]);
        expect(dict["00291201"].Value).toEqual(["k"]);
        // 0x10 and 0x12 are taken, so MOVED gets the first free block
        expect(dict["00290011"].Value).toEqual(["MOVED"]);
        expect(dict["00291101"].Value).toEqual(["m"]);
    });

    it("a block element with no _vrMap entry takes the private dictionary VR", () => {
        const dict = DicomMetaDictionary.denaturalizeDataset({
            "0029:SIEMENS CSA HEADER": {
                creator: "SIEMENS CSA HEADER",
                reservedBlock: 0x10,
                x08: "IMAGE NUM 4", // CSAImageHeaderType, CS
                x99: "unknown"
            }
        });
        expect(dict["00291008"].vr).toBe("CS");
        // no recorded VR and no dictionary entry: skipped, never unwritable
        expect(dict["00291099"]).toBeUndefined();
    });

    it("fromNaturalized writes the blocks back to Part 10", async () => {
        const naturalized = DicomMetaDictionary.naturalizeDataset(sourceDict());
        const writer = new Part10Writer();
        await fromNaturalized(
            {
                ...naturalized,
                _meta: {
                    TransferSyntaxUID: "1.2.840.10008.1.2.1",
                    _vrMap: {}
                }
            },
            writer
        );
        const back = DicomMessage.readFile(writer.write()).dict;

        expect(back["00090010"].Value).toEqual(["ACME"]);
        expect(back["00091001"].Value).toEqual(["nine"]);
        expect(back["00291001"].Value).toEqual([7]);
        expect(back["00291102"].Value).toEqual(["orphan"]);
        expect(back["00400100"].Value[0]["00291005"].Value).toEqual([
            "in-item"
        ]);
    });
});
