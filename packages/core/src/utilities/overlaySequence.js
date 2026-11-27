import log from "../log.js";
import { rangeEntries } from "../dictionary.ranges.data.js";
import { sequenceValue } from "./naturalValues.js";

/**
 * Overlay groups (60xx, xx even) in the naturalized form
 * (docs/specs/naturalized-dataset.md, NAT-U-OVL). All overlay groups use the
 * same keywords, so each group is one item of `OverlaySequence`, with its
 * group as `group` ("6002") and its attributes by keyword. As for a private
 * block, the 8-digit hex tag of each element (`"60023000"`) is a
 * non-enumerable alias on the dataset, and a delete of the alias removes the
 * element from the output.
 */

/** Naturalized name of the overlay groups, which DICOM has as groups 60xx. */
export const OVERLAY_SEQUENCE = "OverlaySequence";

// The overlay aliases that defineOverlayAliases defined, by hex tag:
// { group, keyword, get }.
const OVERLAY_ALIASES = Symbol.for("dcmjs.overlayAliases");

let elementOfKeyword;
let keywordOfElement;
function overlayKeywords() {
    if (!elementOfKeyword) {
        elementOfKeyword = new Map();
        keywordOfElement = new Map();
        for (const r of rangeEntries) {
            if (r.groupMin !== 0x6000) continue;
            const ee = r.elem.toString(16).toUpperCase().padStart(4, "0");
            elementOfKeyword.set(r.name, ee);
            keywordOfElement.set(ee, r.name);
        }
    }
    return { elementOfKeyword, keywordOfElement };
}

/**
 * The overlay group ("6000" to "60FE", even) of an 8-digit hex tag, else
 * undefined. An odd 60xx group is private, not an overlay.
 */
export function overlayGroupOfTag(tag) {
    if (
        typeof tag !== "string" ||
        tag.length !== 8 ||
        !/^60[0-9A-F][02468ACE][0-9A-F]{4}$/i.test(tag)
    ) {
        return undefined;
    }
    return tag.slice(0, 4).toUpperCase();
}

/** The overlay keyword of an 8-digit hex tag, or undefined. */
function overlayKeyword(tag) {
    return (
        overlayGroupOfTag(tag) &&
        overlayKeywords().keywordOfElement.get(tag.slice(4).toUpperCase())
    );
}

/** The OverlaySequence items of `dataset`, as a list. */
function overlayItems(dataset) {
    const seq = dataset[OVERLAY_SEQUENCE];
    if (!seq) return [];
    return Array.isArray(seq) ? seq : [seq];
}

/** The 4-digit uppercase group of an item `group` (a string or a number). */
function groupText(group) {
    return (
        typeof group === "number" ? group.toString(16) : String(group)
    ).toUpperCase();
}

function findItem(dataset, group) {
    return overlayItems(dataset).find(
        item => item && groupText(item.group) === group
    );
}

/**
 * The item of `overlays` (group -> item) that receives the element `tag`, or
 * undefined when `tag` is not in an overlay group. The item is created on
 * first use. Both producers call it, so they give the same items.
 */
export function overlayItem(overlays, tag) {
    const group = overlayGroupOfTag(tag);
    if (!group) {
        return undefined;
    }
    overlays[group] = overlays[group] || { _vrMap: {} };
    return overlays[group];
}

/**
 * Sets `target.OverlaySequence` from `overlays` (group -> item): the items in
 * group order, each with `group`, by the sequence rule (NAT-U-SQ). Then
 * defines the hex-tag aliases.
 */
export function placeOverlayItems(target, overlays) {
    const groups = Object.keys(overlays).sort();
    if (!groups.length) {
        return;
    }
    const items = groups.map(group => {
        overlays[group].group = group;
        return overlays[group];
    });
    target[OVERLAY_SEQUENCE] = sequenceValue(items);
    defineOverlayAliases(target);
}

function ownAliases(target) {
    return Object.prototype.hasOwnProperty.call(target, OVERLAY_ALIASES)
        ? target[OVERLAY_ALIASES]
        : undefined;
}

function aliasDeleted(target, tag, record) {
    const descriptor = Object.getOwnPropertyDescriptor(target, tag);
    return !descriptor || descriptor.get !== record.get;
}

/**
 * Defines a non-enumerable alias `gggg eeee` on `target` for each element of
 * each OverlaySequence item. The alias reads and writes the item that the
 * dataset holds for that group when it is used. Without that item, a write
 * makes a flat hex element. An alias that was deleted stays deleted.
 */
export function defineOverlayAliases(target) {
    let aliases = ownAliases(target);
    if (!aliases) {
        aliases = new Map();
        Object.defineProperty(target, OVERLAY_ALIASES, { value: aliases });
    }
    const { elementOfKeyword } = overlayKeywords();
    for (const item of overlayItems(target)) {
        if (!item || item.group === undefined) continue;
        const group = groupText(item.group);
        for (const keyword of Object.keys(item)) {
            const ee = elementOfKeyword.get(keyword);
            const tag = `${group}${ee}`;
            if (
                !ee ||
                aliases.has(tag) ||
                Object.prototype.hasOwnProperty.call(target, tag)
            ) {
                continue;
            }
            // `this` is the dataset, or an Object.create child of it.
            // shortcut: a child writes into the item of its parent; copy on
            // write as for private blocks when a frame view needs it.
            const record = {
                group,
                keyword,
                get() {
                    return findItem(this, group)?.[keyword];
                }
            };
            const set = function (v) {
                const found = findItem(this, group);
                if (found) {
                    found[keyword] = v;
                    return;
                }
                Object.defineProperty(this, tag, {
                    value: v,
                    writable: true,
                    enumerable: true,
                    configurable: true
                });
            };
            Object.defineProperty(target, tag, {
                get: record.get,
                set,
                configurable: true
            });
            aliases.set(tag, record);
        }
    }
}

/** The hex tags of the overlay aliases of `dataset` that were deleted. */
function deletedAliases(dataset) {
    const deleted = new Set();
    const aliases = ownAliases(dataset);
    if (!aliases) return deleted;
    for (const [tag, record] of aliases) {
        if (aliasDeleted(dataset, tag, record)) deleted.add(tag);
    }
    return deleted;
}

/**
 * Gives `copy`, a copy of the enumerable keys of `source`, the overlay
 * aliases of `source`. An element whose alias was deleted on `source` is
 * removed from the items of `copy`, so the copy writes what `source` writes.
 */
export function copyOverlayAliases(source, copy) {
    if (!ownAliases(source)) return;
    for (const tag of deletedAliases(source)) {
        const item = findItem(copy, tag.slice(0, 4));
        if (item) delete item[overlayKeyword(tag)];
    }
    defineOverlayAliases(copy);
}

/**
 * The item and keyword that a write of the hex tag `tag` goes to in
 * `dataset`, or undefined when `tag` is no overlay element or its alias was
 * deleted. With `create`, a missing item is added to OverlaySequence.
 */
export function overlayElementTarget(dataset, tag, create) {
    const keyword = overlayKeyword(tag);
    if (!keyword) return undefined;
    const record = ownAliases(dataset)?.get(tag.toUpperCase());
    if (record && aliasDeleted(dataset, tag.toUpperCase(), record)) {
        return undefined;
    }
    const group = tag.slice(0, 4).toUpperCase();
    let item = findItem(dataset, group);
    if (!item && create) {
        item = { _vrMap: {}, group };
        const items = [...overlayItems(dataset), item].sort((a, b) =>
            groupText(a.group).localeCompare(groupText(b.group))
        );
        dataset[OVERLAY_SEQUENCE] = sequenceValue(items);
    }
    return item && { item, keyword };
}

/**
 * The flat overlay hex keys of `dataset` (`"60023000"`), as items by group,
 * so they write as an item does. Their VR comes from `dataset._vrMap`.
 */
function flatOverlayItems(dataset) {
    const byGroup = new Map();
    for (const key of Object.keys(dataset)) {
        const keyword = overlayKeyword(key);
        if (!keyword) continue;
        const group = key.slice(0, 4).toUpperCase();
        if (!byGroup.has(group)) byGroup.set(group, { _vrMap: {}, group });
        const item = byGroup.get(group);
        item[keyword] = dataset[key];
        const vr = dataset._vrMap?.[key];
        if (vr) item._vrMap[keyword] = vr;
    }
    return [...byGroup.values()];
}

/** True for a key that denaturalizeOverlays writes: the sequence or a hex key. */
export function isOverlayKey(key) {
    return key === OVERLAY_SEQUENCE || !!overlayKeyword(key);
}

/**
 * Writes the overlays of the naturalized `dataset` into `target`, a DICOM
 * JSON dict: first its flat overlay hex keys, then each OverlaySequence item,
 * so an item wins. `denaturalize(item)` gives the dict of one item. An item
 * without `group` takes group 6000 + 2 * index; `group` can be a number. An
 * element whose alias was deleted is left out.
 */
export function denaturalizeOverlays(dataset, target, denaturalize) {
    const deleted = deletedAliases(dataset);
    const write = (item, index, keepDeleted) => {
        if (!item) {
            return;
        }
        const { group: itemGroup, ...attributes } = item;
        const group = groupText(itemGroup ?? 0x6000 + 2 * index);
        if (!overlayGroupOfTag(`${group}0000`)) {
            log.warn(
                `${OVERLAY_SEQUENCE}: group ${group} is not an overlay group`
            );
            return;
        }
        const tags = denaturalize(attributes);
        Object.keys(tags).forEach(tag => {
            if (!overlayGroupOfTag(tag)) {
                log.warn(
                    `${OVERLAY_SEQUENCE}: ${tag} is not an overlay attribute`
                );
                return;
            }
            const groupTag = group + tag.slice(4);
            if (keepDeleted || !deleted.has(groupTag)) {
                target[groupTag] = tags[tag];
            }
        });
    };
    // a flat key is a value that the user set, also after a delete
    flatOverlayItems(dataset).forEach(item => write(item, 0, true));
    overlayItems(dataset).forEach((item, index) => write(item, index, false));
}
