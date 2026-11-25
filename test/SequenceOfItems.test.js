import {
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    UNDEFINED_LENGTH
} from "../src/constants/dicom";
import "../src/index.js";
import { ReadBufferStream } from "../src/BufferStream";
import { ValueRepresentation } from "../src/ValueRepresentation";
import { DicomMessage } from "../src/DicomMessage";
import { DicomDataReadBufferStreamBuilder } from "./helper/DicomDataReadBufferStreamBuilder";
import { LENGTH_CASES, writeSequenceItems } from "./helper/sequenceItems";

// The item reader that legacy DicomMessage._readTag gives to the SQ reader.
const readOptions = {
    readItem: (itemStream, syntax) => DicomMessage._read(itemStream, syntax)
};

describe("SequenceOfItems extends ValueRepresentation", () => {
    const sequenceOfItems = ValueRepresentation.createByTypeString("SQ");

    describe("zero length tests", () => {
        it("returns an empty elements array", () => {
            const syntax = IMPLICIT_LITTLE_ENDIAN;
            const sqLength = 0x0;
            const streamBuilder = new DicomDataReadBufferStreamBuilder();
            const stream = streamBuilder.build();

            const elements = sequenceOfItems.readBytes(
                stream,
                sqLength,
                syntax,
                readOptions
            );

            expect(elements.length).toBe(0);
        });
    });

    describe("undefined length tests", () => {
        const sqLength = UNDEFINED_LENGTH;
        it("returns an empty elements array", () => {
            const syntax = IMPLICIT_LITTLE_ENDIAN;
            const streamBuilder = new DicomDataReadBufferStreamBuilder();
            streamBuilder.addSequenceDelimitationTagAndValue();
            const stream = streamBuilder.build();

            const elements = sequenceOfItems.readBytes(
                stream,
                sqLength,
                syntax,
                readOptions
            );

            expect(elements.length).toBe(0);
        });

        it("returns an elements array with one empty item", () => {
            const syntax = IMPLICIT_LITTLE_ENDIAN;
            const streamBuilder = new DicomDataReadBufferStreamBuilder();
            streamBuilder.addUndefinedLengthItem();
            streamBuilder.addUndefinedLengthItemDelimitation();
            streamBuilder.addSequenceDelimitationTagAndValue();
            const stream = streamBuilder.build();

            const elements = sequenceOfItems.readBytes(
                stream,
                sqLength,
                syntax,
                readOptions
            );

            expect(elements).toEqual([{}]);
        });

        it("returns an elements array with one item", () => {
            const syntax = IMPLICIT_LITTLE_ENDIAN;
            const streamBuilder = new DicomDataReadBufferStreamBuilder();
            streamBuilder.addUndefinedLengthItem();
            streamBuilder.addUlExampleItem();
            streamBuilder.addUndefinedLengthItemDelimitation();
            streamBuilder.addSequenceDelimitationTagAndValue();
            const stream = streamBuilder.build();

            const elements = sequenceOfItems.readBytes(
                stream,
                sqLength,
                syntax,
                readOptions
            );

            expect(elements.length).toBe(1);
            expect(elements[0]["00020000"].vr).toBe("UL");
            expect(elements[0]["00020000"].Value[0]).toBe(4);
        });
    });

    describe.each([EXPLICIT_LITTLE_ENDIAN, IMPLICIT_LITTLE_ENDIAN])(
        "syntax %s",
        syntax => {
            it.each(LENGTH_CASES)(
                "preserves empty item positions (undefined sequence: %s, undefined items: %s)",
                (undefinedSequence, undefinedItems) => {
                    const item = { "00280010": { vr: "US", Value: [4] } };
                    const { stream, sqLength } = writeSequenceItems(
                        [{}, item, {}],
                        syntax,
                        undefinedSequence,
                        undefinedItems
                    );
                    const readStream = new ReadBufferStream(stream.getBuffer());
                    const elements = sequenceOfItems.readBytes(
                        readStream,
                        sqLength,
                        syntax,
                        readOptions
                    );

                    expect(elements).toHaveLength(3);
                    expect(elements[0]).toEqual({});
                    expect(elements[1]).toMatchObject(item);
                    expect(elements[2]).toEqual({});
                    expect(readStream.end()).toBe(true);
                }
            );
        }
    );
});
