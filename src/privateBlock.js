/**
 * Private block reservation, per PS3.5 Section 7.8.1.
 *
 * A private group is odd. Within it, a Private Creator Data Element at
 * (gggg,00xx) - where xx is 0x10 through 0xFF - identifies an implementer and
 * reserves the block of Data Elements (gggg,xx00) through (gggg,xxFF) for them.
 *
 * So the creator element's low byte IS the block number:
 *
 *     (gggg,0010) "ACME 1.0"   reserves  (gggg,1000) ... (gggg,10FF)
 *     (gggg,0011) "ACME 2.0"   reserves  (gggg,1100) ... (gggg,11FF)
 *     (gggg,00FF) "ACME 9.9"   reserves  (gggg,FF00) ... (gggg,FFFF)
 *
 * Which block a creator gets is decided by whoever wrote the file, not by the
 * creator string, so the block number is never a constant a reader can assume.
 * The creator string is the identity; the block has to be looked up. That is
 * what this module is for, on both sides:
 *
 *     // writing
 *     const block = dicomDict.privateBlock(0x4d43, "ACME 1.0");
 *     block.set(0x01, "CS", ["HYBRID"]);        // -> (4D43,1001)
 *
 *     // reading, from any parsed dict
 *     const block = findPrivateBlock(dict, 0x4d43, "ACME 1.0");
 *     block && block.get(0x01);
 */

const CREATOR_MIN = 0x10;
const CREATOR_MAX = 0xff;
const CREATOR_VR = "LO";
const CREATOR_MAX_LENGTH = 64; // LO

const hex4 = n => n.toString(16).toUpperCase().padStart(4, "0");

/**
 * The full tag key of one element of a reserved block.
 *
 * @param {number} group private group number, odd
 * @param {number} block block number, 0x10 to 0xFF
 * @param {number} element element within the block, 0x00 to 0xFF
 * @returns {string} tag as 'GGGGEEEE', upper case, as parsed dicts are keyed
 */
export function privateTag(group, block, element) {
    assertGroup(group);
    assertBlock(block);
    if (!Number.isInteger(element) || element < 0x00 || element > 0xff) {
        throw new Error(
            `Private element must be 0x00 to 0xFF within its block, got ${element}`
        );
    }
    return hex4(group) + hex4((block << 8) | element);
}

function assertGroup(group) {
    if (!Number.isInteger(group) || group < 0 || group > 0xffff) {
        throw new Error(`Private group must be a 16 bit number, got ${group}`);
    }
    if (group % 2 === 0) {
        // PS3.5 Section 7.8.1: private data elements are in odd groups
        throw new Error(
            `Private group must be odd, got ${hex4(
                group
            )} - an even group is standard, not private`
        );
    }
}

function assertBlock(block) {
    if (
        !Number.isInteger(block) ||
        block < CREATOR_MIN ||
        block > CREATOR_MAX
    ) {
        throw new Error(
            `Private block must be 0x10 to 0xFF, got ${block} - 0x00 to 0x0F are reserved`
        );
    }
}

function assertCreator(creator) {
    if (typeof creator !== "string" || creator.length === 0) {
        throw new Error("Private creator must be a non-empty string");
    }
    if (creator.length > CREATOR_MAX_LENGTH) {
        throw new Error(
            `Private creator must be at most ${CREATOR_MAX_LENGTH} characters (LO), got ${creator.length}`
        );
    }
}

/** The value of a creator element, or undefined when it is absent or empty. */
function creatorAt(dict, group, block) {
    const element = dict[hex4(group) + hex4(block)];
    const value = element && element.Value && element.Value[0];
    return typeof value === "string" ? value.trim() : undefined;
}

/**
 * An accessor for one reserved block of a dict. Returned by findPrivateBlock()
 * and by DicomDict#privateBlock().
 *
 * @param {object} dict parsed dataset, keyed by 'GGGGEEEE'
 * @param {number} group private group number
 * @param {number} block block number, 0x10 to 0xFF
 * @param {string} creator the creator string this block is reserved for
 * @returns {{group: number, block: number, creator: string, tag: Function, has: Function, get: Function, set: Function}}
 */
export function privateBlockAccessor(dict, group, block, creator) {
    assertGroup(group);
    assertBlock(block);
    const tag = element => privateTag(group, block, element);
    return {
        group,
        block,
        creator,
        /** The 'GGGGEEEE' key of an element in this block. */
        tag,
        /** Whether this block holds that element. */
        has: element =>
            Object.prototype.hasOwnProperty.call(dict, tag(element)),
        /** The raw element object, or undefined. */
        get: element => dict[tag(element)],
        /**
         * Write an element of this block.
         *
         * @param {number} element 0x00 to 0xFF
         * @param {string} vr value representation
         * @param {*} values value, or array of values
         * @returns {string} the tag that was written
         */
        set: (element, vr, values) => {
            const key = tag(element);
            dict[key] = {
                vr,
                Value: Array.isArray(values) ? values : [values]
            };
            return key;
        }
    };
}

/**
 * Find the block a creator has already reserved in a dict.
 *
 * @param {object} dict parsed dataset, keyed by 'GGGGEEEE'
 * @param {number} group private group number, odd
 * @param {string} creator creator string to match, compared after trimming
 * @returns {object|null} a block accessor, or null when the creator is absent
 */
export function findPrivateBlock(dict, group, creator) {
    assertGroup(group);
    assertCreator(creator);
    const wanted = creator.trim();
    for (let block = CREATOR_MIN; block <= CREATOR_MAX; block++) {
        if (creatorAt(dict, group, block) === wanted) {
            return privateBlockAccessor(dict, group, block, wanted);
        }
    }
    return null;
}

/**
 * Find the block a creator has reserved, or reserve one for it, writing the
 * creator element into the dict.
 *
 * @param {object} dict parsed dataset, keyed by 'GGGGEEEE'
 * @param {number} group private group number, odd
 * @param {string} creator creator string
 * @returns {object} a block accessor
 */
export function reservePrivateBlock(dict, group, creator) {
    const existing = findPrivateBlock(dict, group, creator);
    if (existing) {
        return existing;
    }
    const wanted = creator.trim();
    for (let block = CREATOR_MIN; block <= CREATOR_MAX; block++) {
        if (creatorAt(dict, group, block) === undefined) {
            dict[hex4(group) + hex4(block)] = {
                vr: CREATOR_VR,
                Value: [wanted]
            };
            return privateBlockAccessor(dict, group, block, wanted);
        }
    }
    throw new Error(
        `No free private block in group ${hex4(
            group
        )} - all of 0x10 to 0xFF are reserved`
    );
}
