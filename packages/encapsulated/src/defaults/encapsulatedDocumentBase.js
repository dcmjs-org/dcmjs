// packages/encapsulated/src/defaults/encapsulatedDocumentBase.js
//
// The base block shared by every encapsulated-document IOD: the SC Equipment
// conversion fields and the Encapsulated Document module defaults.

import {
    combineBases,
    defaultInstanceBase,
    predecessorBase
} from "@dcmjs-org/core";

/** SC Equipment and Encapsulated Document module defaults. */
export function encapsulatedDocumentBase(context) {
    return {
        ConversionType: "WSD",
        BurnedInAnnotation: "YES",
        DocumentTitle: "",
        ContentDate: context.date,
        ContentTime: context.time,
        AcquisitionDateTime: context.dateTime
    };
}

/**
 * The default base of `encapsulate`: core defaults, the block above, and
 * `predecessorBase`, so `predecessor: true` lets a new document replace an
 * older one. The Encapsulated Document module does not define
 * `PredecessorDocumentsSequence`, but does not forbid it: it is a Standard
 * Extended SOP Class attribute.
 */
export const encapsulatedBase = combineBases(
    defaultInstanceBase,
    encapsulatedDocumentBase,
    predecessorBase
);
