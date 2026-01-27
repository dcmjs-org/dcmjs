import { DicomMetadataListener } from "../src/utilities/DicomMetadataListener.js";
import { ArrayBufferExpanderFilter } from "../src/utilities/ArrayBufferExpanderListener.js";

describe("ArrayBufferExpanderFilter", () => {
    describe("filter integration", () => {
        it("can be used as a filter in DicomMetadataListener", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            expect(listener.filters).toContain(ArrayBufferExpanderFilter);
            expect(typeof listener.value).toBe("function");
        });
    });

    describe("filter behavior", () => {
        it("allows normal listener operations to work", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            const tag = "00100010";
            const tagInfo = { vr: "PN", length: 10 };

            listener.startObject({});
            listener.addTag(tag, tagInfo);

            expect(listener.current.tag).toBe(tag);
            expect(listener.current.vr).toBe("PN");
        });

        it("maintains listener state correctly", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            const dest = { testKey: "testValue" };
            listener.startObject(dest);

            expect(listener.current.dest).toBe(dest);
            expect(listener.current.type).toBe("object");

            const result = listener.pop();
            expect(result).toBe(dest);
            expect(listener.current).toBe(null);
        });
    });

    describe("value() method - ArrayBuffer[] expansion", () => {
        it("expands ArrayBuffer[] into startObject[] + multiple value calls + pop", () => {
            // Track the sequence of calls using a custom tracking filter
            const callSequence = [];
            const trackingFilter = {
                startObject(next, dest) {
                    callSequence.push({ method: "startObject" });
                    return next(dest);
                },
                value(next, v) {
                    callSequence.push({ method: "value", value: v });
                    return next(v);
                },
                pop(next) {
                    callSequence.push({ method: "pop" });
                    return next();
                }
            };

            // Create listener with ArrayBufferExpanderFilter first, then tracking
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter,
                trackingFilter
            );

            // Setup: create a tag to hold the value
            listener.startObject({});
            listener.addTag("7FE00010", { vr: "OB" }); // Pixel Data

            // Clear the sequence after setup
            callSequence.length = 0;

            // Create ArrayBuffer array
            const buffer1 = new ArrayBuffer(100);
            const buffer2 = new ArrayBuffer(200);
            const buffer3 = new ArrayBuffer(300);
            const arrayBuffers = [buffer1, buffer2, buffer3];

            // Pass the ArrayBuffer[] to the listener
            listener.value(arrayBuffers);

            // Verify the call sequence
            // startObject([]) calls value([]) internally, then 3 fragment values, then pop
            expect(callSequence.length).toBe(6); // startObject([]) + value([]) + 3 fragment values + pop
            expect(callSequence[0].method).toBe("startObject");
            expect(callSequence[1].method).toBe("value");
            expect(Array.isArray(callSequence[1].value)).toBe(true); // value([]) from startObject
            expect(callSequence[2].method).toBe("value");
            expect(callSequence[2].value).toBe(buffer1);
            expect(callSequence[3].method).toBe("value");
            expect(callSequence[3].value).toBe(buffer2);
            expect(callSequence[4].method).toBe("value");
            expect(callSequence[4].value).toBe(buffer3);
            expect(callSequence[5].method).toBe("pop");
        });

        it("expands Uint8Array[] (typed array views) into fragments", () => {
            const callSequence = [];
            const trackingFilter = {
                startObject(next, dest) {
                    callSequence.push({ method: "startObject" });
                    return next(dest);
                },
                value(next, v) {
                    callSequence.push({ method: "value", value: v });
                    return next(v);
                },
                pop(next) {
                    callSequence.push({ method: "pop" });
                    return next();
                }
            };

            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter,
                trackingFilter
            );

            // Setup
            listener.startObject({});
            listener.addTag("7FE00010", { vr: "OB" });

            // Clear the sequence after setup
            callSequence.length = 0;

            // Create typed array views
            const view1 = new Uint8Array(50);
            const view2 = new Uint8Array(150);
            const typedArrays = [view1, view2];

            // Pass the typed array views to the listener
            listener.value(typedArrays);

            // Verify expansion
            // startObject([]) calls value([]) internally, then 2 fragment values, then pop
            expect(callSequence.length).toBe(5); // startObject([]) + value([]) + 2 fragment values + pop
            expect(callSequence[0].method).toBe("startObject");
            expect(callSequence[1].method).toBe("value");
            expect(Array.isArray(callSequence[1].value)).toBe(true); // value([]) from startObject
            expect(callSequence[2].method).toBe("value");
            expect(callSequence[2].value).toBe(view1);
            expect(callSequence[3].method).toBe("value");
            expect(callSequence[3].value).toBe(view2);
            expect(callSequence[4].method).toBe("pop");
        });

        it("passes through non-ArrayBuffer[] values unchanged", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            // Setup
            listener.startObject({});
            listener.addTag("00100010", { vr: "PN" });

            // Pass through string value
            listener.value("Test^Patient");
            listener.pop();

            const result = listener.pop();
            expect(result["00100010"].Value).toEqual(["Test^Patient"]);
        });

        it("passes through number values unchanged", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            // Setup
            listener.startObject({});
            listener.addTag("00200013", { vr: "IS" }); // Instance Number

            // Pass through number value
            listener.value(1);
            listener.pop();

            const result = listener.pop();
            expect(result["00200013"].Value).toEqual([1]);
        });

        it("passes through single ArrayBuffer unchanged", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            // Setup
            listener.startObject({});
            listener.addTag("7FE00010", { vr: "OB" });

            // Pass through single ArrayBuffer (not in array)
            const buffer = new ArrayBuffer(1000);
            listener.value(buffer);
            listener.pop();

            const result = listener.pop();
            expect(result["7FE00010"].Value).toEqual([buffer]);
        });

        it("passes through arrays of strings unchanged", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            // Setup
            listener.startObject({});
            listener.addTag("00080060", { vr: "CS" }); // Modality

            // Pass through string array (not ArrayBuffer[])
            const stringArray = ["CT", "MR"];
            listener.value(stringArray);
            listener.pop();

            const result = listener.pop();
            expect(result["00080060"].Value).toEqual([stringArray]);
        });

        it("does not expand empty arrays", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            // Setup
            listener.startObject({});
            listener.addTag("7FE00010", { vr: "OB" });

            // Pass through empty array
            const emptyArray = [];
            listener.value(emptyArray);
            listener.pop();

            const result = listener.pop();
            // Should pass through unchanged
            expect(result["7FE00010"].Value).toEqual([emptyArray]);
        });

        it("does not expand mixed arrays (ArrayBuffer + other types)", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            // Setup
            listener.startObject({});
            listener.addTag("7FE00010", { vr: "OB" });

            // Create mixed array (should not be expanded)
            const buffer = new ArrayBuffer(100);
            const mixedArray = [buffer, "not an array buffer"];
            listener.value(mixedArray);
            listener.pop();

            const result = listener.pop();
            // Should pass through unchanged
            expect(result["7FE00010"].Value).toEqual([mixedArray]);
        });
    });

    describe("listener methods integration", () => {
        it("allows access to fmi property", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            const fmi = { "00020010": { Value: ["1.2.840.10008.1.2.1"] } };
            listener.fmi = fmi;

            expect(listener.fmi).toBe(fmi);
        });

        it("allows access to dict property", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            const dict = { "00100010": { Value: ["Test^Patient"] } };
            listener.dict = dict;

            expect(listener.dict).toBe(dict);
        });

        it("allows access to current property", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            listener.startObject({});
            const current = listener.current;

            expect(current).toBeTruthy();
            expect(current.type).toBe("object");
        });

        it("allows use of getTransferSyntaxUID", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            listener.fmi = {
                "00020010": { Value: ["1.2.840.10008.1.2.1"] }
            };

            expect(listener.getTransferSyntaxUID()).toBe("1.2.840.10008.1.2.1");
        });
    });

    describe("real-world usage patterns", () => {
        it("correctly builds nested structure with expanded fragments", () => {
            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter
            );

            const dict = {};
            listener.startObject(dict);

            // Add pixel data tag
            listener.addTag("7FE00010", { vr: "OB" });

            // Pass array of ArrayBuffers (simulating fragmented frame)
            const fragment1 = new ArrayBuffer(100);
            const fragment2 = new ArrayBuffer(150);
            const fragment3 = new ArrayBuffer(200);
            listener.value([fragment1, fragment2, fragment3]);

            listener.pop(); // Pop the tag
            const result = listener.pop(); // Pop the object

            // The resulting structure should have an array of fragments
            expect(result["7FE00010"].Value).toBeInstanceOf(Array);
            expect(result["7FE00010"].Value.length).toBe(3);
            expect(result["7FE00010"].Value[0]).toBe(fragment1);
            expect(result["7FE00010"].Value[1]).toBe(fragment2);
            expect(result["7FE00010"].Value[2]).toBe(fragment3);
        });

        it("can be combined with other filters", () => {
            let loggedValue = null;
            const loggingFilter = {
                value(next, v) {
                    loggedValue = v;
                    return next(v);
                }
            };

            const listener = new DicomMetadataListener(
                ArrayBufferExpanderFilter,
                loggingFilter
            );

            listener.startObject({});
            listener.addTag("00100010", { vr: "PN" });
            listener.value("Test^Patient");
            listener.pop();
            listener.pop();

            expect(loggedValue).toBe("Test^Patient");
        });
    });
});
