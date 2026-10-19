/**
 * The 0.x API, kept as a no-op: returns the tag unchanged. The legacy readers
 * now add the value accessors (PN) when they store a value, so a tag no longer
 * needs a Proxy that adds them on assignment. A value that a caller assigns
 * later does not get accessors; use the dicom+json model for PN, for example
 * `[{ Alphabetic: "Doe^John" }]`.
 * @param {any} tag the tag object
 * @returns {any} the same tag object
 */
export function addTagAccessors(tag) {
    return tag;
}
