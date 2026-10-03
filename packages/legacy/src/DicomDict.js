import { ValueRepresentation, writePart10 } from "@dcmjs-org/core";

// Kept for API compatibility, same pattern as Tag.setDicomMessageClass: the
// wrapper index, legacy's DicomMessage module, and existing callers still
// wire the slot, but write() no longer reaches the eager engine — it
// delegates to core's writePart10 — so nothing here reads it anymore.
// eslint-disable-next-line no-unused-vars
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

    // The Part 10 envelope (preamble/DICM, computed meta group length,
    // deflate branch, default transfer syntax) moved verbatim to
    // @dcmjs-org/core as writePart10 (core/writeCore.js); this delegation
    // keeps the options and semantics unchanged, including the in-place
    // TransferSyntaxUID default on this.meta.
    write(writeOptions = { allowInvalidVRLength: false }) {
        return writePart10(this, writeOptions);
    }

    /** Helper method to avoid circular dependencies */
    static setDicomMessageClass(dicomMessageClass) {
        DicomMessage = dicomMessageClass;
    }
}

export { DicomDict };
