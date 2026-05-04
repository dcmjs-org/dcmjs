import { TrackingIdentifier } from "../src/sr/templates.js";

/**
 * Regression for https://github.com/dcmjs-org/dcmjs/issues/434 — Template
 * subclasses must call super(), not super(options), or the options object is
 * inserted as the first array element (ContentSequence extends Array).
 */
describe("TrackingIdentifier", () => {
    it("contains only DICOM content items, not the raw options object", () => {
        const id = new TrackingIdentifier({
            identifier: "ROI #1",
            uid: "1.2.3.4.5.6.7.8.9"
        });
        expect(id).toHaveLength(2);
        expect(id[0].ValueType).toBe("TEXT");
        expect(id[1].ValueType).toBe("UIDREF");
    });

    it("with only uid is a single UIDREF item", () => {
        const id = new TrackingIdentifier({
            uid: "1.2.3.4.5.6.7.8.9"
        });
        expect(id).toHaveLength(1);
        expect(id[0].ValueType).toBe("UIDREF");
    });
});
