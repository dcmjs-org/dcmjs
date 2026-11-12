import {
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    UNDEFINED_LENGTH
} from "../src/constants/dicom";
import "../src/index.js";
import { ReadBufferStream, WriteBufferStream } from "../src/BufferStream";
import { ValueRepresentation } from "../src/ValueRepresentation";
import { DicomMessage } from "../src/DicomMessage";
import { DicomDataReadBufferStreamBuilder } from "./helper/DicomDataReadBufferStreamBuilder";

ValueRepresentation.setDicomMessageClass(DicomMessage);

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
                syntax
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
                syntax
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
                syntax
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
                syntax
            );

            expect(elements.length).toBe(1);
            expect(elements[0]["00020000"].vr).toBe("UL");
            expect(elements[0]["00020000"].Value[0]).toBe(4);
        });
    });

    describe.each([EXPLICIT_LITTLE_ENDIAN, IMPLICIT_LITTLE_ENDIAN])(
        "syntax %s",
        syntax => {
            it.each([
                [false, false],
                [false, true],
                [true, false],
                [true, true]
            ])(
                "preserves empty item positions (undefined sequence: %s, undefined items: %s)",
                (undefinedSequence, undefinedItems) => {
                    const stream = new WriteBufferStream(256, true);
                    const item = { "00280010": { vr: "US", Value: [4] } };

                    for (const value of [{}, item, {}]) {
                        const itemStream = new WriteBufferStream(256, true);
                        DicomMessage.write(value, itemStream, syntax);
                        stream.writeUint16(0xfffe);
                        stream.writeUint16(0xe000);
                        stream.writeUint32(
                            undefinedItems ? UNDEFINED_LENGTH : itemStream.size
                        );
                        stream.concat(itemStream);
                        if (undefinedItems) {
                            stream.writeUint16(0xfffe);
                            stream.writeUint16(0xe00d);
                            stream.writeUint32(0);
                        }
                    }

                    const sqLength = undefinedSequence
                        ? UNDEFINED_LENGTH
                        : stream.size;
                    if (undefinedSequence) {
                        stream.writeUint16(0xfffe);
                        stream.writeUint16(0xe0dd);
                        stream.writeUint32(0);
                    }
                    const readStream = new ReadBufferStream(
                        stream.getBuffer(),
                        true
                    );
                    const elements = sequenceOfItems.readBytes(
                        readStream,
                        sqLength,
                        syntax
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
