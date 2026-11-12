import {
    ValueRepresentation,
    writePart10,
    findPrivateBlock,
    reservePrivateBlock
} from "@dcmjs-org/core";

// Kept for API compatibility: the wrapper index, legacy's DicomMessage
// module, and existing callers still
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
        if (!this.dict[tag]) {
            this.dict[tag] = { vr: vr };
        }
        this.dict[tag].Value = ValueRepresentation.addValueAccessorsFor(
            this.dict[tag].vr,
            values
        );
    }

    /**
     * Reserves a private block for a creator, and writes its creator element
     * when the creator has no block yet; pass `{ create: false }` to only look
     * it up. The block is found by creator, never assumed (NAT-U-PRIV-11).
     *
     *     dicomDict.privateBlock("4D43:ACME 1.0").set("x01", "CS", ["HYBRID"]);
     *
     * @param {number|string} groupOrKey odd group number, or block key "gggg:creator"
     * @param {string} [creator] creator string, with a group number
     * @param {{create?: boolean}} [options] create defaults to true; false
     *     returns null when the creator is absent
     * @returns {Object|null} accessor with key, group, creator, reservedBlock,
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
