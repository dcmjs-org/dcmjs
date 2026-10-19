/**
 * The naturalized cardinality rule of 1.0: a declared VM is scalar only when
 * it is exactly "1" or "0-1". Any other VM (1-n, 2, 2-n, 3, 6, ...) allows
 * more than one value, so its naturalized value stays a list. An unknown tag
 * (no VM) is scalar.
 *
 * @param {string} [vm] the VM from the dictionary entry
 * @returns {boolean} true when the naturalized value stays a list
 */
export default function isMultiVM(vm) {
    if (!vm) {
        return false;
    }
    return vm !== "1" && vm !== "0-1";
}
