import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";

/**
 * §15.4 — the naturalized listener should remain suitable for very large
 * datasets (enhanced multi-frame, hundreds of thousands of sequence items)
 * without excessive garbage. These tests drive the listener directly so the
 * scale is in the event stream, not a giant in-memory source dict.
 */

describe("NaturalizedListener — scale (§15.4)", () => {
    test("naturalizes a 100k-item PerFrameFunctionalGroupsSequence correctly", () => {
        const N = 100000;
        const l = new NaturalizedListener();
        l.startDataSet({});
        l.startSequence("52009230", { vr: "SQ" }); // PerFrameFunctionalGroupsSequence
        for (let i = 0; i < N; i++) {
            l.startItem({});
            l.startElement("00200013", { vr: "IS" }); // InstanceNumber
            l.value(i + 1);
            l.endElement();
            l.endItem();
        }
        l.endSequence();
        l.endDataSet();

        const seq = l.result.PerFrameFunctionalGroupsSequence;
        expect(Array.isArray(seq)).toBe(true);
        expect(seq).toHaveLength(N);
        expect(seq[0].InstanceNumber).toBe(1);
        expect(seq[N - 1].InstanceNumber).toBe(N);
        expect(l.violations).toEqual([]);
    });

    test("handles deep recursive nesting (SR-style ContentSequence)", () => {
        const DEPTH = 500;
        const l = new NaturalizedListener();
        l.startDataSet({});
        for (let d = 0; d < DEPTH; d++) {
            l.startSequence("0040A730", { vr: "SQ" }); // ContentSequence
            l.startItem({});
            l.startElement("0040A040", { vr: "CS" }); // ValueType
            l.value("CONTAINER");
            l.endElement();
        }
        for (let d = 0; d < DEPTH; d++) {
            l.endItem();
            l.endSequence();
        }
        l.endDataSet();

        // Walk down the nesting and confirm it reconstructed to full depth.
        let node = l.result;
        for (let d = 0; d < DEPTH; d++) {
            expect(node.ContentSequence).toBeDefined();
            node = node.ContentSequence; // single-item sequence proxy -> the item
        }
        expect(node.ValueType).toBe("CONTAINER");
    });
});
