/**
 * Extract private tag entries from dictionary.mjs and emit an encoded format
 * similar to dicom.packed.js: keyBlob (tag name strings), vr/vm tables, nameBlob,
 * plus base64-encoded keyOff, keyLen, vrCode, vmCode, nameOff, nameLen.
 * Supports lookup by full private tag key e.g. '(0019,"TOSHIBA_MEC_CT_1.0",06)'.
 */
import dict from "./dictionary.mjs";
import { writeFile } from "node:fs/promises";

const exactRe = /^\(([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4})\)$/;
const rangeRe = /^\([0-9A-Fa-f]{4}-[0-9A-Fa-f]{4},[0-9A-Fa-f]{4}\)$/;

const entries = [];
for (const [k, v] of Object.entries(dict.default ?? dict)) {
    if (exactRe.test(k) || rangeRe.test(k)) continue;
    entries.push({
        key: k,
        vr: v.vr ?? "",
        vm: v.vm ?? "",
        name: v.name ?? "",
    });
}
entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

function makeTable(values) {
    const table = [];
    const map = new Map();
    const codes = new Uint8Array(values.length);
    let i = 0;
    for (const v of values) {
        let idx = map.get(v);
        if (idx === undefined) {
            idx = table.length;
            table.push(v);
            map.set(v, idx);
        }
        if (idx > 255) throw new Error("Too many unique VR/VM values for Uint8 codes");
        codes[i++] = idx;
    }
    return { table, codes };
}

const vrs = entries.map((e) => e.vr);
const vms = entries.map((e) => e.vm);
const { table: vrTable, codes: vrCode } = makeTable(vrs);
const { table: vmTable, codes: vmCode } = makeTable(vms);

let keyBlob = "";
const keyOff = new Uint32Array(entries.length);
const keyLen = new Uint16Array(entries.length);
for (let i = 0; i < entries.length; i++) {
    const key = entries[i].key;
    keyOff[i] = keyBlob.length;
    keyLen[i] = key.length;
    keyBlob += key;
}

let nameBlob = "";
const nameOff = new Uint32Array(entries.length);
const nameLen = new Uint16Array(entries.length);
for (let i = 0; i < entries.length; i++) {
    const n = entries[i].name;
    nameOff[i] = nameBlob.length;
    nameLen[i] = n.length;
    nameBlob += n;
}

function toBase64(ta) {
    const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
    return Buffer.from(u8).toString("base64");
}
function toBase64U8(u8) {
    return Buffer.from(u8).toString("base64");
}

const payload = {
    keyOff_b64: toBase64(keyOff),
    keyLen_b64: toBase64(keyLen),
    vrCode_b64: toBase64U8(vrCode),
    vmCode_b64: toBase64U8(vmCode),
    nameOff_b64: toBase64(nameOff),
    nameLen_b64: toBase64(nameLen),
};

const out = `// AUTO-GENERATED from dictionary.mjs by generate/pack_private.mjs
// Private tags only (creator strings). Decoded on first use; use ensurePrivateLoaded() if needed.

export const vrTable = ${JSON.stringify(vrTable)};
export const vmTable = ${JSON.stringify(vmTable)};
export const keyBlob = ${JSON.stringify(keyBlob)};
export const nameBlob = ${JSON.stringify(nameBlob)};

const _b64 = ${JSON.stringify(payload, null, 2)};

let _init;

function _decodeB64ToU8(b64) {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function _u8ToTyped(u8, Ctor) {
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  return new Ctor(buf);
}

export function initPackedPrivate() {
  if (_init) return _init;
  const keyOffU8 = _decodeB64ToU8(_b64.keyOff_b64);
  const keyLenU8 = _decodeB64ToU8(_b64.keyLen_b64);
  const vrCodeU8 = _decodeB64ToU8(_b64.vrCode_b64);
  const vmCodeU8 = _decodeB64ToU8(_b64.vmCode_b64);
  const nameOffU8 = _decodeB64ToU8(_b64.nameOff_b64);
  const nameLenU8 = _decodeB64ToU8(_b64.nameLen_b64);
  _init = {
    keyOff: _u8ToTyped(keyOffU8, Uint32Array),
    keyLen: _u8ToTyped(keyLenU8, Uint16Array),
    vrCode: vrCodeU8,
    vmCode: vmCodeU8,
    nameOff: _u8ToTyped(nameOffU8, Uint32Array),
    nameLen: _u8ToTyped(nameLenU8, Uint16Array),
  };
  return _init;
}

export function lookupPrivateTag(keyStr) {
  if (typeof keyStr !== "string" || keyStr.length === 0) return undefined;
  const { keyOff, keyLen, vrCode, vmCode, nameOff, nameLen } = initPackedPrivate();
  let lo = 0;
  let hi = keyOff.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const start = keyOff[mid];
    const len = keyLen[mid];
    const candidate = keyBlob.slice(start, start + len);
    if (keyStr < candidate) hi = mid - 1;
    else if (keyStr > candidate) lo = mid + 1;
    else {
      const vr = vrTable[vrCode[mid]];
      const vm = vmTable[vmCode[mid]];
      const off = nameOff[mid];
      const nlen = nameLen[mid];
      const name = nameBlob.slice(off, off + nlen);
      return { vr, vm, name };
    }
  }
  return undefined;
}
`;

await writeFile(new URL("../src/dictionary.private.data.js", import.meta.url), out);

console.log(
    JSON.stringify(
        {
            privateCount: entries.length,
            keyBlobLen: keyBlob.length,
            nameBlobLen: nameBlob.length,
            vrUnique: vrTable.length,
            vmUnique: vmTable.length,
        },
        null,
        2
    )
);
