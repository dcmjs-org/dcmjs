/**
 * Records the VR of one element in a _vrMap when the dictionary does not fix
 * it: the dictionary VR is data-dependent ("ox") or differs from the element
 * VR, or the element has no dictionary entry (NAT-I-VR-1).
 *
 * @param {Object} vrMap - the _vrMap of the dataset or item
 * @param {string} key - the naturalized key of the element
 * @param {Object} [entry] - the dictionary entry, when there is one
 * @param {string} [vr] - the VR of the element
 */
export function recordVr(vrMap, key, entry, vr) {
    if (vr && (!entry || entry.vr === "ox" || entry.vr !== vr)) {
        vrMap[key] = vr;
    }
}
