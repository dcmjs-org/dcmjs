import { dictionary, lookupRegisteredTagByName } from "../dictionary.fast.js";
import { Tag } from "../Tag.js";
import { createLatin1Decoder } from "../charset/latin1.js";
import { base64ToArrayBuffer } from "./base64.js";
import { isBinaryData } from "./binaryFragment.js";
import { recordVr } from "./vrMap.js";
import {
    definePersonNameAccessor,
    toPersonNameValue
} from "./personNameValue.js";
import { valueLength } from "./isMultiVM.js";
import log from "../log.js";

/**
 * Private data elements in the naturalized form (PS3.5 7.8.1).
 *
 * A Private Creator Data Element (gggg,00xx) reserves the block of elements
 * (gggg,xx00-xxFF). The naturalized form groups a reserved block under one
 * key, `${gggg}:${creator}`, so the block can move to another xx on write:
 *
 *     "0029:ACME": { creator: "ACME", reservedBlock: 0x10, x10: ["a"], x11: [...] }
 *     _vrMap: { "0029:ACME": { x10: "LO", x11: "OB" } }
 *
 * - `xEE` is the element number within the reserved block, as 2 hex digits.
 * - `creator` repeats the creator string of the key; the key is the authority.
 * - `reservedBlock` is the xx of the source; denaturalize keeps it when free.
 * - Non-enumerable aliases keep the older names: the 8-digit hex tag of each
 *   element and of the creator on the dataset, a registerTag() keyword on the
 *   dataset and in the block, and a private dictionary keyword in the block.
 *   Each alias reads the block through its key when it is used. A `delete` of
 *   a dataset alias removes that element (for the creator alias: the block)
 *   from the denaturalized output. Object.keys, JSON and denaturalize see only
 *   the block form.
 * - A private element without a creator keeps its 8-digit hex tag as the key,
 *   with its VR in _vrMap under that tag.
 *
 * docs/specs/naturalized-dataset.md (NAT-U-PRIV, NAT-U-HIST, NAT-U-RT) is
 * the specification.
 */

const BLOCK_KEY = /^([0-9A-Fa-f]{4}):(.+)$/;
const ELEMENT_KEY = /^x([0-9A-Fa-f]{2})$/;
const HEX_TAG = /^[0-9A-Fa-f]{8}$/;

/** True for an 8-digit hex tag key, for example "00291001". */
export function isHexTag(key) {
    return typeof key === "string" && HEX_TAG.test(key);
}
// The dataset aliases that definePrivateAliases defined, by name:
// { key, elementKey } (elementKey is null for a creator alias).
const DATASET_ALIASES = Symbol.for("dcmjs.privateAliases");
// LO holds at most 64 characters.
const CREATOR_MAX_BYTES = 64;

const latin1 = createLatin1Decoder();

function hex2(n) {
    return n.toString(16).toUpperCase().padStart(2, "0");
}

function tagOf(hexTag) {
    return HEX_TAG.test(hexTag) ? Tag.fromString(hexTag) : undefined;
}

/**
 * True for an 8-digit hex tag of a private creator (gggg,0010-00FF) or a
 * private data element (Tag.isPrivateCreator / Tag.isPrivateValue).
 */
export function isPrivateTag(hexTag) {
    const tag = typeof hexTag === "string" ? tagOf(hexTag) : undefined;
    return !!tag && (tag.isPrivateCreator() || tag.isPrivateValue());
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

/** The registerTag() entry (or the dictionary entry) of an 8-digit hex tag. */
export function registeredTagEntry(hexTag) {
    return dictionary[`(${hexTag.slice(0, 4)},${hexTag.slice(4, 8)})`];
}

function defineAlias(target, name, get, set) {
    if (Object.prototype.hasOwnProperty.call(target, name)) return false;
    Object.defineProperty(target, name, { get, set, configurable: true });
    return true;
}

/**
 * True when the dataset alias `name` was deleted, or replaced by a plain
 * value, after definePrivateAliases defined it.
 */
function aliasDeleted(target, name, record) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    return !descriptor || descriptor.get !== record.get;
}

/**
 * Defines the non-enumerable aliases of every reserved block in `target`
 * (see the module comment). The aliases derive from the blocks alone, so a
 * caller can call this again on a clone. An alias that was deleted stays
 * deleted.
 */
export function definePrivateAliases(target) {
    let aliases = target[DATASET_ALIASES];
    if (!aliases) {
        aliases = new Map();
        Object.defineProperty(target, DATASET_ALIASES, { value: aliases });
    }
    const onDataset = (name, key, elementKey, creatorName) => {
        if (aliases.has(name)) return;
        const record = { key, elementKey };
        record.get =
            elementKey === null
                ? () =>
                      target[key]
                          ? parsePrivateBlockKey(key, target[key])?.creator
                          : undefined
                : () => target[key]?.[elementKey];
        const set =
            elementKey === null
                ? undefined
                : v => {
                      const creator = aliases.get(creatorName);
                      const creatorDeleted =
                          creator && aliasDeleted(target, creatorName, creator);
                      if (target._vrMap?.[key]?.[elementKey] === "PN") {
                          v = toPersonNameValue(v); // NAT-U-SET-2
                      }
                      if (target[key] && !creatorDeleted) {
                          target[key][elementKey] = v;
                          return;
                      }
                      // the block is gone (or its creator alias was deleted):
                      // the value becomes a flat element, with the VR that
                      // the block had for it
                      Object.defineProperty(target, name, {
                          value: v,
                          writable: true,
                          enumerable: true,
                          configurable: true
                      });
                      const vr = target._vrMap?.[key]?.[elementKey];
                      if (vr && target._vrMap) target._vrMap[name] = vr;
                  };
        if (defineAlias(target, name, record.get, set)) {
            aliases.set(name, record);
        }
    };
    for (const key of Object.keys(target)) {
        const block = target[key];
        const parsed = parsePrivateBlockKey(key, block);
        if (!parsed || typeof block.reservedBlock !== "number") continue;
        const { group, creator } = parsed;
        const xx = hex2(block.reservedBlock);
        onDataset(`${group}00${xx}`, key, null);
        for (const elementKey of Object.keys(block)) {
            const match = ELEMENT_KEY.exec(elementKey);
            if (!match) continue;
            const ee = match[1].toUpperCase();
            const tag = `${group}${xx}${ee}`;
            onDataset(tag, key, elementKey, `${group}00${xx}`);
            const registered = registeredTagEntry(tag);
            if (registered && registered.name) {
                onDataset(registered.name, key, elementKey, `${group}00${xx}`);
                defineAlias(
                    block,
                    registered.name,
                    () => block[elementKey],
                    v => (block[elementKey] = v)
                );
            }
            const known = privateDictionaryEntry(group, creator, ee);
            if (known && known.name && known.name !== "Unknown") {
                defineAlias(
                    block,
                    known.name,
                    () => block[elementKey],
                    v => (block[elementKey] = v)
                );
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
    const blockOfCreator = new Map();
    for (const { tag, value } of elements) {
        if (!tagOf(tag).isPrivateCreator()) continue;
        const creator = creatorText(value);
        if (creator === "") continue;
        const hexTag = tag.toUpperCase();
        const key = `${hexTag.slice(0, 4)}:${creator}`;
        if (blockOfCreator.has(key)) {
            // PS3.5 7.8.1 permits one block per creator in a group
            log.warn(
                `Private creator "${creator}" reserves two blocks in group ${hexTag.slice(
                    0,
                    4
                )} (${blockOfCreator.get(key)} and ${hexTag.slice(
                    6,
                    8
                )}); their elements merge into one block, and an element in both keeps the last value`
            );
        } else {
            blockOfCreator.set(key, hexTag.slice(6, 8));
        }
        creators.set(hexTag, creator);
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
            if (vr === "PN") {
                // the converting setter of a PN attribute (NAT-U-VAL-5)
                definePersonNameAccessor(
                    target,
                    name,
                    valueLength(entry),
                    value
                );
            } else {
                target[name] = value;
            }
            recordVr(vrMap, name, entry, vr);
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

/**
 * The creator string of a private creator value, without the LO padding. A
 * creator that was read as UN (implicit VR, or a gateway that converts
 * unknown VRs) holds bytes, or an `{ InlineBinary }` from DICOM JSON; the
 * first 64 bytes decode as LO text. A number, a reference or another object
 * is no creator.
 */
function creatorText(value) {
    let v = Array.isArray(value) ? value[0] : value;
    if (v && typeof v === "object" && v.InlineBinary !== undefined) {
        v = Array.isArray(v.InlineBinary) ? v.InlineBinary[0] : v.InlineBinary;
        if (typeof v === "string") v = base64ToArrayBuffer(v);
    }
    let text;
    if (isBinaryData(v)) {
        const bytes = ArrayBuffer.isView(v)
            ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
            : new Uint8Array(v);
        text = latin1.decode(bytes.subarray(0, CREATOR_MAX_BYTES));
    } else {
        text = typeof v === "string" ? v : "";
    }
    return text.replace(/^ +|[\0 ]+$/g, "");
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
 * The 8-digit hex tag of a flat private key: an 8-digit hex key, or a
 * registerTag() keyword of a private tag. Undefined for other keys.
 */
function flatPrivateTag(key) {
    if (isPrivateTag(key)) return key.toUpperCase();
    const registered = lookupRegisteredTagByName(key);
    if (!registered) return undefined;
    const hexTag = registered.tag.replace(/[(),]/g, "").toUpperCase();
    return isPrivateTag(hexTag) ? hexTag : undefined;
}

/**
 * The elements and blocks that a `delete` of a dataset alias removed. A
 * delete always wins: the element (or, for a creator alias, the block) is
 * left out whatever value the block holds at the write.
 */
function deletedByAlias(dataset) {
    const deleted = { blocks: new Set(), elements: new Set() };
    const aliases = dataset[DATASET_ALIASES];
    if (!aliases) return deleted;
    for (const [name, record] of aliases) {
        if (!aliasDeleted(dataset, name, record)) continue;
        const { key, elementKey } = record;
        if (elementKey === null) deleted.blocks.add(key);
        else deleted.elements.add(`${key}\n${elementKey}`);
    }
    return deleted;
}

/**
 * The block key and element key of a private alias on `dataset` (a hex tag
 * or a registerTag() keyword), or undefined when `name` is no live alias.
 */
export function privateAliasTarget(dataset, name) {
    const record = dataset[DATASET_ALIASES]?.get(name);
    if (!record || aliasDeleted(dataset, name, record)) return undefined;
    return { key: record.key, elementKey: record.elementKey };
}

/**
 * The inverse of placePrivateElements: a shallow view of `dataset` where each
 * reserved block is a private creator plus 8-digit hex keys, with their VRs
 * in a flat _vrMap, so the hex-key path of denaturalizeDataset writes them.
 *
 * - A block keeps its reservedBlock when that xx is free in the group, and
 *   gets the first free xx otherwise. A flat private key (hex tag or
 *   registerTag() keyword) holds its xx.
 * - A flat private data element with no flat creator, in the reserved range
 *   of a block, joins that block, unless the block already holds that
 *   element number; then it holds the xx, and the block moves.
 * - An element or block whose dataset alias was deleted is left out.
 *
 * Returns `dataset` when it has no blocks.
 */
export function expandPrivateBlocks(dataset) {
    const keys = Object.keys(dataset);
    const blocks = [];
    const flat = [];
    for (const key of keys) {
        const parsed = parsePrivateBlockKey(key, dataset[key]);
        if (parsed) {
            blocks.push({ key, ...parsed, block: dataset[key], joined: [] });
        } else {
            const hexTag = flatPrivateTag(key);
            if (hexTag) flat.push({ key, hexTag });
        }
    }
    if (!blocks.length) return dataset;

    const sourceVrMap = dataset._vrMap || {};
    const deleted = deletedByAlias(dataset);
    const used = new Map();
    const usedIn = group => {
        if (!used.has(group)) used.set(group, new Set());
        return used.get(group);
    };
    const flatCreators = new Set(
        flat.filter(f => tagOf(f.hexTag).isPrivateCreator()).map(f => f.hexTag)
    );
    const joinedKeys = new Set();
    for (const { key, hexTag } of flat) {
        const group = hexTag.slice(0, 4);
        const element = parseInt(hexTag.slice(4, 8), 16);
        const xx = element <= 0x00ff ? element : element >> 8;
        const ee = hexTag.slice(6, 8);
        const owner =
            element > 0x00ff &&
            !flatCreators.has(`${group}00${hexTag.slice(4, 6)}`) &&
            blocks.find(b => b.group === group && b.block.reservedBlock === xx);
        // join the block, unless the block already holds that element
        const taken =
            owner &&
            `x${ee}` in owner.block &&
            !deleted.elements.has(`${owner.key}\nx${ee}`);
        if (owner && !taken && !deleted.blocks.has(owner.key)) {
            owner.joined.push({ key, ee });
            joinedKeys.add(key);
        } else {
            usedIn(group).add(xx);
        }
    }

    // the blocks whose reservedBlock is free keep it; the others move
    const assigned = new Map();
    for (const pass of [true, false]) {
        for (const b of blocks) {
            if (assigned.has(b) || deleted.blocks.has(b.key)) continue;
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

    const view = {};
    const vrMap = {};
    for (const key of Object.keys(sourceVrMap)) {
        if (!parsePrivateBlockKey(key, sourceVrMap[key])) {
            vrMap[key] = sourceVrMap[key];
        }
    }
    const byKey = new Map(blocks.map(b => [b.key, b]));
    for (const key of keys) {
        if (key === "_vrMap" || joinedKeys.has(key)) continue;
        const b = byKey.get(key);
        if (!b) {
            view[key] = dataset[key];
            continue;
        }
        if (deleted.blocks.has(key)) continue;
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
        const creatorTag = `${b.group}00${hex2(xx)}`;
        view[creatorTag] = b.creator;
        vrMap[creatorTag] = "LO";
        const blockVrs = sourceVrMap[key] || {};
        const emit = (ee, value, vr, name) => {
            vr = vr || privateDictionaryEntry(b.group, b.creator, ee)?.vr;
            if (!vr || !/^[A-Z]{2}$/.test(vr)) {
                log.warn(`No VR for ${name} in private block`, key);
                return;
            }
            const tag = `${b.group}${hex2(xx)}${ee}`;
            view[tag] = value;
            vrMap[tag] = vr;
        };
        for (const elementKey of Object.keys(b.block)) {
            if (elementKey === "creator" || elementKey === "reservedBlock") {
                continue;
            }
            const match = ELEMENT_KEY.exec(elementKey);
            if (!match) {
                log.warn(`Unknown name in private block ${key}:`, elementKey);
                continue;
            }
            if (deleted.elements.has(`${key}\n${elementKey}`)) continue;
            emit(
                match[1].toUpperCase(),
                b.block[elementKey],
                blockVrs[elementKey],
                elementKey
            );
        }
        for (const { key: flatKey, ee } of b.joined) {
            emit(
                ee,
                dataset[flatKey],
                sourceVrMap[flatKey] ||
                    blockVrs[`x${ee}`] ||
                    lookupRegisteredTagByName(flatKey)?.vr,
                flatKey
            );
        }
    }
    view._vrMap = vrMap;
    return view;
}
