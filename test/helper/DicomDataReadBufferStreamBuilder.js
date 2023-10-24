import { ReadBufferStream } from "../../src/BufferStream";
import {
    ITEM_DELIMITATION_LENGTH,
    SEQUENCE_DELIMITATION_VALUE,
    UNDEFINED_LENGTH
} from "../../src/constants/dicom";
import { DicomMetaDictionary } from "../../src/DicomMetaDictionary";

export class DicomDataReadBufferStreamBuilder {
    constructor() {
        this.itemArray = [];
        this.options = {
            ignoreErrors: false,
            untilTag: null,
            includeUntilTagValue: false,
            noCopy: false
        };
    }

    addSequenceDelimitationTagAndValue() {
        this.splitIntoFourTwoByteItemsAndAddToDataArray(
            DicomMetaDictionary.tagAsIntegerFromName("SequenceDelimitationItem")
        );
        this.splitIntoFourTwoByteItemsAndAddToDataArray(
            SEQUENCE_DELIMITATION_VALUE
        );
    }

    addUndefinedLengthItem() {
        this.splitIntoFourTwoByteItemsAndAddToDataArray(
            DicomMetaDictionary.tagAsIntegerFromName("Item")
        );
        this.splitIntoFourTwoByteItemsAndAddToDataArray(UNDEFINED_LENGTH);
    }

    addUndefinedLengthItemDelimitation() {
        this.splitIntoFourTwoByteItemsAndAddToDataArray(
            DicomMetaDictionary.tagAsIntegerFromName("ItemDelimitationItem")
        );
        this.splitIntoFourTwoByteItemsAndAddToDataArray(
            ITEM_DELIMITATION_LENGTH
        );
    }

    /**
     * Converts a 8 byte hexadecimal value into a 4 * 2 byte String values array.
     * (0xfffee00d -> ['0xff', '0xfe', '0xe0', 0x0d'])
     */
    splitIntoFourTwoByteItemsAndAddToDataArray(hexValue) {
        let hexValueItemArray = [];

        for (
            let index = 0;
            index < hexValue.toString(16).length;
            index = index + 2
        ) {
            hexValueItemArray.push(
                "0x" + hexValue.toString(16).slice(index, index + 2)
            );
        }

        // ensure 4 items in the array
        while (hexValueItemArray.length < 4) {
            hexValueItemArray = ["0x00"].concat(hexValueItemArray);
        }

        this.itemArray = this.itemArray.concat(hexValueItemArray);
    }

    /**
     * Adds a "File Meta Information Group Length" tag (0002,0000) with the length 4 and the value 4 to the stream.
     */
    addUlExampleItem() {
        const fileMetaInfoGroupLengthTag = ["0x02", "0x00", "0x00", "0x00"];
        const length = ["0x04", "0x00", "0x00", "0x00"];
        const item = ["0x04", "0x00", "0x00", "0x00"];

        this.itemArray = this.itemArray.concat(fileMetaInfoGroupLengthTag);
        this.itemArray = this.itemArray.concat(length);
        this.itemArray = this.itemArray.concat(item);
    }

    build() {
        const byteArray = new Uint8Array(this.itemArray);
        return new ReadBufferStream(byteArray.buffer, null, {
            noCopy: this.options.noCopy
        });
    }
}
