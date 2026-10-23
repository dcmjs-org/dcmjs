/**
 * True for a VR code (two capital letters, for example "LO"); false for a
 * dictionary code such as "ox" or "xs", which is not a VR.
 */
export function isVrCode(vr) {
    return typeof vr === "string" && /^[A-Z]{2}$/.test(vr);
}

/**
 * True when the dictionary does not fix the VR of an element: the dictionary
 * VR is data-dependent ("ox") or differs from the element VR, or the element
 * has no dictionary entry (NAT-I-VR-1). Such a VR goes into _vrMap.
 *
 * @param {Object} [entry] - the dictionary entry, when there is one
 * @param {string} [vr] - the VR of the element
 * @returns {boolean}
 */
export function vrNeedsRecord(entry, vr) {
    return !!vr && (!entry || entry.vr === "ox" || entry.vr !== vr);
}

/**
 * Records the VR of one element in a _vrMap when vrNeedsRecord says so.
 *
 * @param {Object} vrMap - the _vrMap of the dataset or item
 * @param {string} key - the naturalized key of the element
 * @param {Object} [entry] - the dictionary entry, when there is one
 * @param {string} [vr] - the VR of the element
 */
export function recordVr(vrMap, key, entry, vr) {
    if (vrNeedsRecord(entry, vr)) {
        vrMap[key] = vr;
    }
}
