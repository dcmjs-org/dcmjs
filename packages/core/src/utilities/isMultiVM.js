/**
 * The naturalized cardinality rule of 1.0 for a declared VM: the VM is scalar
 * only when it is exactly "1" or "0-1". Any other VM (1-n, 2, 2-n, 3, 6, ...)
 * allows more than one value, so its naturalized value stays a list. With no
 * VM it returns false; the value of an element with no VM follows
 * valueLength below (a list), and a sequence with one item is the item.
 *
 * @param {string} [vm] the VM from the dictionary entry
 * @returns {boolean} true when the declared VM allows more than one value
 */
export default function isMultiVM(vm) {
    if (!vm) {
        return false;
    }
    return vm !== "1" && vm !== "0-1";
}

/**
 * The value count of an attribute from its dictionary entry: 1 for a scalar
 * VM, else undefined (a list), also for an entry with no VM or no entry
 * (NAT-U-VAL-1, NAT-U-VAL-2, NAT-U-VAL-4).
 *
 * @param {{vm?: string}} [entry]
 * @returns {1|undefined}
 */
export function valueLength(entry) {
    return entry?.vm && !isMultiVM(entry.vm) ? 1 : undefined;
}
