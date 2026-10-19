/**
 * Exposes a single-item sequence as its item object, which also behaves like
 * a one-element list. This is the 1.0 naturalized shape (no Proxy):
 *
 * - `seq.CodeValue` reads the item's own field, because `seq` IS the item;
 * - `seq[0] === seq` and `seq.length === 1`;
 * - `for (const item of seq)` iterates once;
 * - `Array.isArray(seq)` is false, and JSON.stringify(seq) gives the item.
 *
 * `0`, `length` and the iterator are non-enumerable, so Object.keys, JSON and
 * denaturalize see only the item's attributes. The legacy (0.x) Proxy version
 * lives in @dcmjs-org/legacy.
 *
 * @param {object|object[]} dest the item, or an array that holds one item
 * @param {object} [sqZero] the item, when dest is the array that holds it
 * @returns the item with the list accessors; dest unchanged when it is not a
 *     single item
 */
const addAccessors = (dest, sqZero) => {
    let item = sqZero;
    if (item === undefined) {
        if (!dest || typeof dest !== "object") return dest;
        if (Array.isArray(dest)) {
            if (dest.length !== 1) return dest;
            item = dest[0];
        } else {
            item = dest;
        }
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return dest;
    if (Object.prototype.hasOwnProperty.call(item, "length")) return item;

    Object.defineProperties(item, {
        0: { value: item, configurable: true },
        length: { value: 1, configurable: true },
        [Symbol.iterator]: {
            value: function* () {
                yield item;
            },
            configurable: true
        }
    });
    return item;
};

export default addAccessors;
