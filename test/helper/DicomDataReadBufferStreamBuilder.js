import { ReadBufferStream } from "../../src/BufferStream";
import { ITEM_DELIMITATION_TAG, ITEM_TAG, SEQUENCE_DELIMITATION_TAG } from "../../src/constants/dicom/Tags";
import { ITEM_DELIMITATION_LENGTH, SEQUENCE_DELIMITATION_VALUE, UNDEFINED_LENGTH } from "../../src/constants/dicom/Values";

export class DicomDataReadBufferStreamBuilder {
    constructor() {
        this.itemArray = [];
        this.options = {
            ignoreErrors: false,
            untilTag: null,
            includeUntilTagValue: false,
            noCopy: false
        }
    }

    addSequenceDelimitationTagAndValue() {
        this.splitIntoFourTwoByteItemsAndAddToDataArray(SEQUENCE_DELIMITATION_TAG);
        this.splitIntoFourTwoByteItemsAndAddToDataArray(SEQUENCE_DELIMITATION_VALUE);
    }

    addUndefinedLengthItem() {
        this.splitIntoFourTwoByteItemsAndAddToDataArray(ITEM_TAG);
        this.splitIntoFourTwoByteItemsAndAddToDataArray(UNDEFINED_LENGTH);
    }

    addUndefinedLengthItemDelimitation() {
        this.splitIntoFourTwoByteItemsAndAddToDataArray(ITEM_DELIMITATION_TAG);
        this.splitIntoFourTwoByteItemsAndAddToDataArray(ITEM_DELIMITATION_LENGTH);
    }

    splitIntoFourTwoByteItemsAndAddToDataArray(hexValue) {
        let hexValueItemArray = [];

        for (let index = 0; index < hexValue.toString(16).length; index = index + 2) {
            hexValueItemArray.push('0x' + hexValue.toString(16).slice(index, index + 2));
        }

        // ensure 4 items in the array
        while (hexValueItemArray.length < 4) {
            hexValueItemArray = ['0x00'].concat(hexValueItemArray);
        }

        this.itemArray = this.itemArray.concat(hexValueItemArray);
    }

    addUlExampleItem() {
        const fileMetaInfoGroupLengthTag = ['0x02', '0x00', '0x00', '0x00'];
        // const fileMetaInfoGroupLengthVr = 'UL';
        const length = ['0x04', '0x00', '0x00', '0x00'];
        const item = ['0x04', '0x00', '0x00', '0x00'];

        this.itemArray = this.itemArray.concat(fileMetaInfoGroupLengthTag);
        // this.itemArray.push(fileMetaInfoGroupLengthVr.charCodeAt(0).toString(16), fileMetaInfoGroupLengthVr.charCodeAt(1).toString(16));
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