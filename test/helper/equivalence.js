/**
 * Deep equivalence helpers shared by the lazy-core tests
 * (test/lazy-bridge.test.js, test/lazy-equivalence.test.js).
 *
 * Handles the dict entry zoo: addTagAccessors proxies (transparent to
 * property access), PN values (plain objects or boxed String instances),
 * ArrayBuffers and typed arrays (byte-wise, kind-sensitive: an eager
 * noCopy Uint8Array does not equal a plain ArrayBuffer), and strict
 * null-vs-undefined. Collects human-readable problems instead of failing
 * on the first difference.
 */

function byteKind(value) {
    if (value instanceof ArrayBuffer) {
        return "ArrayBuffer";
    }
    if (ArrayBuffer.isView(value)) {
        return value.constructor.name;
    }
    return null;
}

function toBytes(value) {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function isStringLike(value) {
    return typeof value === "string" || value instanceof String;
}

function deepCompare(a, b, where, problems) {
    if (problems.length > 25) {
        return; // enough signal
    }
    if (Object.is(a, b)) {
        return;
    }

    // strict null vs undefined: only equal to themselves (handled above)
    if (a === null || b === null || a === undefined || b === undefined) {
        problems.push(`${where}: ${String(a)} !== ${String(b)}`);
        return;
    }

    const aIsString = isStringLike(a);
    const bIsString = isStringLike(b);
    if (aIsString || bIsString) {
        if (!aIsString || !bIsString) {
            problems.push(`${where}: string vs ${typeof b} mismatch`);
        } else if (String(a) !== String(b)) {
            problems.push(
                `${where}: ${JSON.stringify(String(a))} !== ${JSON.stringify(
                    String(b)
                )}`
            );
        } else if (a instanceof String !== b instanceof String) {
            problems.push(`${where}: String box vs primitive mismatch`);
        }
        return;
    }

    if (typeof a !== "object" || typeof b !== "object") {
        // numbers (incl. -0/NaN via Object.is), booleans, bigints
        problems.push(`${where}: ${String(a)} !== ${String(b)}`);
        return;
    }

    const aBytesKind = byteKind(a);
    const bBytesKind = byteKind(b);
    if (aBytesKind || bBytesKind) {
        if (aBytesKind !== bBytesKind) {
            problems.push(
                `${where}: binary kind mismatch ${aBytesKind} !== ${bBytesKind}`
            );
            return;
        }
        const aBytes = toBytes(a);
        const bBytes = toBytes(b);
        if (aBytes.length !== bBytes.length) {
            problems.push(
                `${where}: byte length ${aBytes.length} !== ${bBytes.length}`
            );
            return;
        }
        for (let i = 0; i < aBytes.length; i++) {
            if (aBytes[i] !== bBytes[i]) {
                problems.push(
                    `${where}: bytes differ at index ${i} (${aBytes[i]} !== ${bBytes[i]})`
                );
                return;
            }
        }
        return;
    }

    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);
    if (aIsArray !== bIsArray) {
        problems.push(`${where}: array vs object mismatch`);
        return;
    }
    if (aIsArray) {
        if (a.length !== b.length) {
            problems.push(`${where}: array length ${a.length} !== ${b.length}`);
            return;
        }
        for (let i = 0; i < a.length; i++) {
            deepCompare(a[i], b[i], `${where}[${i}]`, problems);
        }
        return;
    }

    // plain objects (PN dicom+json objects, nested SQ dicts, entries)
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.join(",") !== bKeys.join(",")) {
        problems.push(`${where}: key sets differ [${aKeys}] vs [${bKeys}]`);
        return;
    }
    for (const key of aKeys) {
        deepCompare(a[key], b[key], `${where}.${key}`, problems);
    }
}

/**
 * Compares one dict section (meta or dict) entry-by-entry, collecting
 * problems into the given array (or a fresh one). Returns the problems
 * array; the caller asserts on it (so multiple sections can share one
 * report).
 */
function collectSectionProblems(eagerSection, lazySection, where, problems) {
    const eagerTags = Object.keys(eagerSection).sort();
    const lazyTags = Object.keys(lazySection).sort();
    if (eagerTags.join(",") !== lazyTags.join(",")) {
        problems.push(
            `${where}: tag sets differ\n  eager: [${eagerTags}]\n  lazy:  [${lazyTags}]`
        );
        return problems;
    }

    for (const tag of eagerTags) {
        const eagerEntry = eagerSection[tag];
        const lazyEntry = lazySection[tag];
        deepCompare(
            eagerEntry.vr,
            lazyEntry.vr,
            `${where}.${tag}.vr`,
            problems
        );
        deepCompare(
            eagerEntry.Value,
            lazyEntry.Value,
            `${where}.${tag}.Value`,
            problems
        );
        deepCompare(
            eagerEntry._rawValue,
            lazyEntry._rawValue,
            `${where}.${tag}._rawValue`,
            problems
        );
    }
    return problems;
}

function compareSection(eagerSection, lazySection, where) {
    const eagerTags = Object.keys(eagerSection).sort();
    const lazyTags = Object.keys(lazySection).sort();
    expect(lazyTags).toEqual(eagerTags);
    const problems = collectSectionProblems(
        eagerSection,
        lazySection,
        where,
        []
    );
    expect(problems).toEqual([]);
}

export { deepCompare, collectSectionProblems, compareSection };
