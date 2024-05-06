import {
    IMPLICIT_LITTLE_ENDIAN,
    UNDEFINED_LENGTH
} from "../src/constants/dicom";
import "../src/index.js";
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

        it("returns an empty elements array sinnce the item is empty", () => {
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

            expect(elements.length).toBe(0);
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
});
