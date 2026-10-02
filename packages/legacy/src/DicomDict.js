import pako from "pako";
import {
    WriteBufferStream,
    ValueRepresentation,
    DEFLATED_EXPLICIT_LITTLE_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    TagHex
} from "@dcmjs/core";

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
        if (useSyntax === DEFLATED_EXPLICIT_LITTLE_ENDIAN) {
            // Deflate-on-write (W4). Per PS3.10 A.5 only the dataset
            // after the meta group is deflated - the preamble, "DICM" and
            // the meta group (written uncompressed above) never are. The
            // deflated syntax implies an explicit little endian body, so
            // the body is produced as ELE into a scratch stream, then
            // raw-deflated (RFC 1951, no zlib header - the mirror of the
            // read side's inflateRaw).
            const bodyStream = new WriteBufferStream(4096, true);
            DicomMessage.write(
                this.dict,
                bodyStream,
                EXPLICIT_LITTLE_ENDIAN,
                writeOptions
            );
            fileStream.writeRawBytes(
                pako.deflateRaw(new Uint8Array(bodyStream.getBuffer()))
            );
            return fileStream.getBuffer();
        }
        DicomMessage.write(this.dict, fileStream, useSyntax, writeOptions);
        return fileStream.getBuffer();
    }

    /** Helper method to avoid circular dependencies */
    static setDicomMessageClass(dicomMessageClass) {
        DicomMessage = dicomMessageClass;
    }
}

export { DicomDict };
