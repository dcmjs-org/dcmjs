import { dictionary } from "../dictionary.fast.js";
import log from "../log.js";

/**
 * Private data elements in the naturalized form (PS3.5 7.8.1).
 *
 * A Private Creator Data Element (gggg,00xx) reserves the block of elements
 * (gggg,xx00-xxFF). The naturalized form groups a reserved block under one
 * key, `${gggg}:${creator}`, so the block can move to another xx on write:
 *
 *     "0029:ACME": { creator: "ACME", reservedBlock: 0x10, x10: "a", x11: [...] }
 *     _vrMap: { "0029:ACME": { x10: "LO", x11: "OB" } }
 *
 * - `xEE` is the element number within the reserved block, as 2 hex digits.
 * - `creator` repeats the creator string of the key; the key is the authority.
 * - `reservedBlock` is the xx of the source; denaturalize keeps it when free.
 * - Non-enumerable aliases keep the older names readable: the 8-digit hex tag
 *   of each element and of the creator on the dataset, a registerTag() keyword
 *   on the dataset and in the block, and a private dictionary keyword in the
 *   block. Object.keys, JSON and denaturalize see only the block form.
 * - A private element without a creator keeps its 8-digit hex tag as the key,
 *   with its VR in _vrMap under that tag.
 */

const BLOCK_KEY = /^([0-9A-Fa-f]{4}):(.+)$/;
const ELEMENT_KEY = /^x([0-9A-Fa-f]{2})$/;
const HEX_TAG = /^[0-9A-Fa-f]{8}$/;

function hex2(n) {
    return n.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * True for an 8-digit hex tag in an odd group at element 0x0010 or above:
 * a private creator or a private data element. Odd-group elements
 * 0x0000-0x000F keep the standard handling.
 */
export function isPrivateTag(tag) {
    if (typeof tag !== "string" || !HEX_TAG.test(tag)) return false;
    const group = parseInt(tag.slice(0, 4), 16);
    const element = parseInt(tag.slice(4, 8), 16);
    return (group & 1) === 1 && element >= 0x0010;
}

/** The group and creator of a reserved block key, or undefined. */
export function parsePrivateBlockKey(key, value) {
    const match = BLOCK_KEY.exec(key);
    if (!match || !value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const group = match[1].toUpperCase();
    if ((parseInt(group, 16) & 1) !== 1) return undefined;
    return { group, creator: match[2] };
}

function privateDictionaryEntry(group, creator, ee) {
    return dictionary[`(${group},"${creator}",${ee})`];
}

function registeredEntry(tag) {
    return dictionary[`(${tag.slice(0, 4)},${tag.slice(4, 8)})`];
}

function defineAlias(target, name, get, set) {
    if (Object.prototype.hasOwnProperty.call(target, name)) return;
    Object.defineProperty(target, name, { get, set, configurable: true });
}

/**
 * Defines the non-enumerable aliases of every reserved block in `target`
 * (see the module comment). The aliases derive from the blocks alone, so a
 * caller can call this again on a clone.
 */
export function definePrivateAliases(target) {
    for (const key of Object.keys(target)) {
        const block = target[key];
        const parsed = parsePrivateBlockKey(key, block);
        if (!parsed || typeof block.reservedBlock !== "number") continue;
        const { group, creator } = parsed;
        const xx = hex2(block.reservedBlock);
        defineAlias(target, `${group}00${xx}`, () => creator);
        for (const elementKey of Object.keys(block)) {
            const match = ELEMENT_KEY.exec(elementKey);
            if (!match) continue;
            const ee = match[1].toUpperCase();
            const tag = `${group}${xx}${ee}`;
            const get = () => block[elementKey];
            const set = v => {
                block[elementKey] = v;
            };
            defineAlias(target, tag, get, set);
            const registered = registeredEntry(tag);
            if (registered && registered.name) {
                defineAlias(target, registered.name, get, set);
                defineAlias(block, registered.name, get, set);
            }
            const known = privateDictionaryEntry(group, creator, ee);
            if (known && known.name && known.name !== "Unknown") {
                defineAlias(block, known.name, get, set);
            }
        }
    }
}

/**
 * Places the private elements of one dataset level into `target` in the
 * naturalized form, then defines the aliases.
 *
 * @param {Object} target - the naturalized dataset or sequence item
 * @param {Object} vrMap - its _vrMap
 * @param {{tag: string, vr?: string, value: *, entry?: Object}[]} elements -
 *   the private elements of the level (isPrivateTag), with naturalized values,
 *   in any order
 */
export function placePrivateElements(target, vrMap, elements) {
    if (!elements.length) return;
    const creators = new Map();
    for (const { tag, value } of elements) {
        const element = parseInt(tag.slice(4, 8), 16);
        const creator = Array.isArray(value) ? value[0] : value;
        if (element <= 0x00ff && creator != null && creator !== "") {
            creators.set(tag.toUpperCase(), String(creator));
        }
    }

    for (const { tag: rawTag, vr, value, entry } of elements) {
        const tag = rawTag.toUpperCase();
        const group = tag.slice(0, 4);
        if (creators.has(tag)) {
            blockFor(target, group, creators.get(tag), tag.slice(6, 8));
            continue;
        }
        const creator = creators.get(`${group}00${tag.slice(4, 6)}`);
        if (creator === undefined) {
            // no creator: the hex tag (or a registerTag() keyword) is the key
            const name = entry?.name || tag;
            target[name] = value;
            if (vr && (!entry || entry.vr !== vr)) vrMap[name] = vr;
            continue;
        }
        const key = `${group}:${creator}`;
        const block = blockFor(target, group, creator, tag.slice(4, 6));
        const elementKey = `x${tag.slice(6, 8)}`;
        block[elementKey] = value;
        if (vr) {
            vrMap[key] = vrMap[key] || {};
            vrMap[key][elementKey] = vr;
        }
    }
    definePrivateAliases(target);
}

function blockFor(target, group, creator, xx) {
    const key = `${group}:${creator}`;
    if (!target[key]) {
        target[key] = { creator, reservedBlock: parseInt(xx, 16) };
    }
    return target[key];
}

function isFreeBlock(used, xx) {
    return xx >= 0x10 && xx <= 0xff && !used.has(xx);
}

function firstFreeBlock(used) {
    for (let xx = 0x10; xx <= 0xff; xx++) {
        if (!used.has(xx)) return xx;
    }
    return undefined;
}

/**
 * The inverse of placePrivateElements: a shallow view of `dataset` where each
 * reserved block is a private creator plus 8-digit hex keys, with their VRs
 * in a flat _vrMap, so the hex-key path of denaturalizeDataset writes them.
 * A block keeps its reservedBlock when that xx is free in the group, and gets
 * the first free xx otherwise. Returns `dataset` when it has no blocks.
 */
export function expandPrivateBlocks(dataset) {
    const keys = Object.keys(dataset);
    const blocks = [];
    const used = new Map();
    const usedIn = group => {
        if (!used.has(group)) used.set(group, new Set());
        return used.get(group);
    };
    for (const key of keys) {
        const parsed = parsePrivateBlockKey(key, dataset[key]);
        if (parsed) {
            blocks.push({ key, ...parsed, block: dataset[key] });
        } else if (isPrivateTag(key)) {
            // a flat private element or creator holds its xx
            const element = parseInt(key.slice(4, 8), 16);
            usedIn(key.slice(0, 4).toUpperCase()).add(
                element <= 0x00ff ? element : element >> 8
            );
        }
    }
    if (!blocks.length) return dataset;

    // the blocks whose reservedBlock is free keep it; the others move
    const assigned = new Map();
    for (const pass of [true, false]) {
        for (const b of blocks) {
            if (assigned.has(b)) continue;
            const inGroup = usedIn(b.group);
            const preferred = b.block.reservedBlock;
            let xx;
            if (isFreeBlock(inGroup, preferred)) xx = preferred;
            else if (!pass) xx = firstFreeBlock(inGroup);
            if (xx === undefined) continue;
            inGroup.add(xx);
            assigned.set(b, xx);
        }
    }

    const sourceVrMap = dataset._vrMap || {};
    const view = {};
    const vrMap = {};
    for (const key of Object.keys(sourceVrMap)) {
        if (!parsePrivateBlockKey(key, sourceVrMap[key])) {
            vrMap[key] = sourceVrMap[key];
        }
    }
    const byKey = new Map(blocks.map(b => [b.key, b]));
    for (const key of keys) {
        if (key === "_vrMap") continue;
        const b = byKey.get(key);
        if (!b) {
            view[key] = dataset[key];
            continue;
        }
        const xx = assigned.get(b);
        if (xx === undefined) {
            log.warn(`No free private block in group ${b.group} for`, key);
            continue;
        }
        if (b.block.creator !== undefined && b.block.creator !== b.creator) {
            log.warn(
                `Private block ${key} has creator "${b.block.creator}"; the key creator "${b.creator}" is used`
            );
        }
        const block = `${b.group}00${hex2(xx)}`;
        view[block] = b.creator;
        vrMap[block] = "LO";
        const blockVrs = sourceVrMap[key] || {};
        for (const elementKey of Object.keys(b.block)) {
            if (elementKey === "creator" || elementKey === "reservedBlock") {
                continue;
            }
            const match = ELEMENT_KEY.exec(elementKey);
            if (!match) {
                log.warn(`Unknown name in private block ${key}:`, elementKey);
                continue;
            }
            const ee = match[1].toUpperCase();
            const vr =
                blockVrs[elementKey] ||
                privateDictionaryEntry(b.group, b.creator, ee)?.vr;
            if (!vr || !/^[A-Z]{2}$/.test(vr)) {
                log.warn(`No VR for ${elementKey} in private block`, key);
                continue;
            }
            const tag = `${b.group}${hex2(xx)}${ee}`;
            view[tag] = b.block[elementKey];
            vrMap[tag] = vr;
        }
    }
    view._vrMap = vrMap;
    return view;
}
