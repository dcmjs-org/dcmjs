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
     * Reserves a private block for a creator, and writes its creator element
     * when the creator has no block yet; pass `{ create: false }` to only look
     * it up. See src/privateBlock.js: the block is found by creator, never
     * assumed.
     *
     *     dicomDict.privateBlock("4D43:ACME 1.0").set("x01", "CS", ["HYBRID"]);
     *
     * @param {number|string} groupOrKey odd group number, or block key "gggg:creator"
     * @param {string} [creator] creator string, with a group number
     * @param {{create?: boolean}} [options] create defaults to true; false
     *     returns null when the creator is absent
     * @returns {object|null} accessor with key, group, creator, reservedBlock,
     *     tag, has, get and set
     */
    privateBlock(groupOrKey, creator, options = {}) {
        if (typeof groupOrKey === "string" && typeof creator === "object") {
            options = creator;
            creator = undefined;
        }
        const { create = true } = options || {};
        return create
            ? reservePrivateBlock(this.dict, groupOrKey, creator)
            : findPrivateBlock(this.dict, groupOrKey, creator);
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
