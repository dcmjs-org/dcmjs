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
    const { _meta, ...rest } = dataset;
    return fromDataSet(
        {
            meta: _meta ? DicomMetaDictionary.denaturalizeDataset(_meta) : null,
            dict: DicomMetaDictionary.denaturalizeDataset(rest)
        },
        listener
    );
}
