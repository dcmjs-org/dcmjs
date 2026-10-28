import { WriteBufferStream } from "./BufferStream";
import { ValueRepresentation } from "./ValueRepresentation";
import { TagHex } from "./constants/dicom";
import { findPrivateBlock, reservePrivateBlock } from "./privateBlock.js";

const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";

let DicomMessage;

class DicomDict {
    constructor(meta) {
        this.meta = meta;
        this.dict = {};
    }

    upsertTag(tag, vr, values) {
        if (this.dict[tag]) {
            // Should already have tag accessors.
            this.dict[tag].Value = values;
        } else {
            this.dict[tag] = ValueRepresentation.addTagAccessors({ vr: vr });
            this.dict[tag].Value = values;
        }
    }

    /**
     * The private block a creator has reserved in this dataset, reserving one
     * if it has none yet. See src/privateBlock.js: which block a creator holds
     * is decided by whoever wrote the file, so it has to be looked up by the
     * creator string rather than assumed.
     *
     * @param {number} group private group number, odd
     * @param {string} creator private creator identification code
     * @param {{create?: boolean}} [options] create defaults to true; pass false
     *     to look the block up without writing a creator element, which returns
     *     null when the creator is absent
     * @returns {object|null} a block accessor with tag/has/get/set
     */
    privateBlock(group, creator, options = {}) {
        const { create = true } = options;
        return create
            ? reservePrivateBlock(this.dict, group, creator)
            : findPrivateBlock(this.dict, group, creator);
    }

    write(writeOptions = { allowInvalidVRLength: false }) {
        var metaSyntax = EXPLICIT_LITTLE_ENDIAN;
        var fileStream = new WriteBufferStream(4096, true);
        fileStream.writeUint8Repeat(0, 128);
        fileStream.writeAsciiString("DICM");

        var metaStream = new WriteBufferStream(1024);
        if (!this.meta[TagHex.TransferSyntaxUID]) {
            this.meta[TagHex.TransferSyntaxUID] = {
                vr: "UI",
                Value: [EXPLICIT_LITTLE_ENDIAN]
            };
        }
        DicomMessage.write(this.meta, metaStream, metaSyntax, writeOptions);
        DicomMessage.writeTagObject(
            fileStream,
            TagHex.FileMetaInformationGroupLength,
            "UL",
            metaStream.size,
            metaSyntax,
            writeOptions
        );
        fileStream.concat(metaStream);

        var useSyntax = this.meta[TagHex.TransferSyntaxUID].Value[0];
        DicomMessage.write(this.dict, fileStream, useSyntax, writeOptions);
        return fileStream.getBuffer();
    }

    /** Helper method to avoid circular dependencies */
    static setDicomMessageClass(dicomMessageClass) {
        DicomMessage = dicomMessageClass;
    }
}

export { DicomDict };
