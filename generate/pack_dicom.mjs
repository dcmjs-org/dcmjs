import dict from './dictionary.mjs';

const exactRe = /^\(([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4})\)$/;
const entries = [];
for (const [k, v] of Object.entries(dict.default ?? dict)) {
  const m = exactRe.exec(k);
  if (!m) continue;
  entries.push({
    group: parseInt(m[1], 16),
    elem: parseInt(m[2], 16),
    vr: v.vr ?? '',
    vm: v.vm ?? '',
    name: v.name ?? ''
  });
}
entries.sort((a,b)=> (a.group-b.group) || (a.elem-b.elem));

// Build string tables for VR and VM
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
    if (idx > 255) throw new Error('Too many unique values for Uint8 codes');
    codes[i++] = idx;
  }
  return { table, codes };
}

const vrs = entries.map(e=>e.vr);
const vms = entries.map(e=>e.vm);
const { table: vrTable, codes: vrCode } = makeTable(vrs);
const { table: vmTable, codes: vmCode } = makeTable(vms);

// Build name blob and offsets
let nameBlob = '';
const nameOff = new Uint32Array(entries.length);
const nameLen = new Uint16Array(entries.length); // names are short
for (let i=0;i<entries.length;i++) {
  const n = entries[i].name;
  nameOff[i] = nameBlob.length;
  nameLen[i] = n.length;
  nameBlob += n;
}

// Build group arrays and element arrays
const groupsArr = [];
const groupStartArr = [];
const elems = new Uint16Array(entries.length);
for (let i=0;i<entries.length;i++) elems[i] = entries[i].elem;

let currentGroup = -1;
for (let i=0;i<entries.length;i++) {
  const g = entries[i].group;
  if (g !== currentGroup) {
    currentGroup = g;
    groupsArr.push(g);
    groupStartArr.push(i);
  }
}
const groups = Uint16Array.from(groupsArr);
const groupStart = Uint32Array.from(groupStartArr);

// base64 encode helpers
function toBase64(ta) {
  const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  return Buffer.from(u8).toString('base64');
}
function toBase64U8(u8) {
  return Buffer.from(u8).toString('base64');
}

const payload = {
  groups_b64: toBase64(groups),
  groupStart_b64: toBase64(groupStart),
  elems_b64: toBase64(elems),
  vrCode_b64: toBase64U8(vrCode),
  vmCode_b64: toBase64U8(vmCode),
  nameOff_b64: toBase64(nameOff),
  nameLen_b64: toBase64(nameLen),
};

const out = `// AUTO-GENERATED from dictionary.js. Exact (GGGG,EEEE) tags only.
// Provides very fast startup: most data is binary base64 decoded once.

export const vrTable = ${JSON.stringify(vrTable)};
export const vmTable = ${JSON.stringify(vmTable)};

// All names concatenated into one string; offsets/lengths index into it.
export const nameBlob = ${JSON.stringify(nameBlob)};

const _b64 = ${JSON.stringify(payload, null, 2)};

let _init;

function _decodeB64ToU8(b64) {
  // Browser: atob; Node: Buffer
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function _u8ToTyped(u8, Ctor) {
  // Ensure proper alignment by copying into a fresh ArrayBuffer
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  return new Ctor(buf);
}

export function initPacked() {
  if (_init) return _init;
  const groupsU8 = _decodeB64ToU8(_b64.groups_b64);
  const groupStartU8 = _decodeB64ToU8(_b64.groupStart_b64);
  const elemsU8 = _decodeB64ToU8(_b64.elems_b64);
  const vrCodeU8 = _decodeB64ToU8(_b64.vrCode_b64);
  const vmCodeU8 = _decodeB64ToU8(_b64.vmCode_b64);
  const nameOffU8 = _decodeB64ToU8(_b64.nameOff_b64);
  const nameLenU8 = _decodeB64ToU8(_b64.nameLen_b64);

  _init = {
    groups: _u8ToTyped(groupsU8, Uint16Array),
    groupStart: _u8ToTyped(groupStartU8, Uint32Array),
    elems: _u8ToTyped(elemsU8, Uint16Array),
    vrCode: vrCodeU8, // already Uint8Array
    vmCode: vmCodeU8, // already Uint8Array
    nameOff: _u8ToTyped(nameOffU8, Uint32Array),
    nameLen: _u8ToTyped(nameLenU8, Uint16Array),
  };
  return _init;
}
`;

await fsWrite('./src/dicom.packed.js', out);


console.log(JSON.stringify({ exactCount: entries.length, groupCount: groups.length, vrUnique: vrTable.length, vmUnique: vmTable.length, nameBlobLen: nameBlob.length }, null, 2));

async function fsWrite(p, s) {
  const fs = await import('node:fs/promises');
  await fs.writeFile(p, s);
}
