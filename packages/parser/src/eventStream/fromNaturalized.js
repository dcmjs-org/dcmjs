import { DicomMetaDictionary } from "@dcmjs-org/core";
import { fromDataSet } from "./fromDataSet.js";

/**
 * fromNaturalized — the naturalized-dataset source. It denaturalizes the
 * dataset (and its `_meta`, when present) with
 * DicomMetaDictionary.denaturalizeDataset and streams the result through
 * fromDataSet, so every sink (Part10Writer, DicomWebJsonWriter, ...) undoes
 * the naturalized form the same way, private blocks included.
 *
 * @param {Object} dataset - a naturalized dataset
 * @param {import("./EventStreamListener").EventStreamListener} listener
 */
export function fromNaturalized(dataset, listener) {
    // no copy of the dataset: a copy loses the alias deletes (NAT-U-HIST-7);
    // denaturalizeDataset skips the _meta member
    const meta = dataset._meta;
    return fromDataSet(
        {
            meta: meta ? DicomMetaDictionary.denaturalizeDataset(meta) : null,
            dict: DicomMetaDictionary.denaturalizeDataset(dataset)
        },
        listener
    );
}
