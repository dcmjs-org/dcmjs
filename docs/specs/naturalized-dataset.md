# Naturalized dataset specification

## Scope

This specification defines the naturalized dataset of dcmjs 1.0: the
keyword-keyed JavaScript object that applications read and edit in place of
the tag-keyed DICOM JSON model. It covers the keys, the value shapes, the
`_vrMap` side table, private data elements, the historical names, and the
conversion back to DICOM.

Two producers make a naturalized dataset, and the two must give the same
object:

- `DicomMetaDictionary.naturalizeDataset(dict)` in `@dcmjs-org/core`, from a
  DICOM JSON dict.
- `NaturalizedListener` in `@dcmjs-org/parser`, from the event stream
  (`DicomEventStream.toNaturalized()`).

Two consumers undo the naturalized dataset:

- `DicomMetaDictionary.denaturalizeDataset(dataset)`.
- `fromNaturalized(dataset, listener)` (`DicomEventStream.fromNaturalized()`),
  which feeds every event-stream sink, for example `Part10Writer`.

The 0.x shapes (the tag Proxy, the collapse of every one-value list) are out
of scope. They stay in `@dcmjs-org/legacy`.

**Change rule.** The two requirement sections below have different change
rules:

- You can change an implementation requirement (`NAT-I-*`) when a better
  approach appears.
- You change a user requirement (`NAT-U-*`) in two cases only: the
  requirement describes the behaviour wrongly, or the intended user-facing
  behaviour changes. An implementation that is inconvenient is not a reason
  to change a user requirement. A change to a user requirement also needs an
  entry in `docs/MIGRATION.md`.

## Terms

| Term | Meaning |
| --- | --- |
| Private group | An odd group number `gggg`. |
| Private creator | The element `(gggg,00xx)`, `xx` from `10` to `FF`. Its value is the creator string (PS3.5 7.8.1). |
| Reserved block | The elements `(gggg,xx00-xxFF)` that the creator `(gggg,00xx)` reserves. `xx` is the block number. |
| Element number | `ee` in `(gggg,xxee)`: the element number within a reserved block (PS3.5 7.8.1 Note). |
| Block key | The key `` `${gggg}:${creator}` `` of a reserved block, for example `"0029:ACME"`. |
| Element key | The key `` `x${ee}` `` of a value in a block, for example `x01`. |
| Alias | A non-enumerable property that gives a second name for a value. |

All hex digits in keys are uppercase.

## Example

The DICOM JSON dict

```js
{
  "00100010": { vr: "PN", Value: [{ Alphabetic: "Doe^Jane" }] },
  "00080008": { vr: "CS", Value: ["ORIGINAL"] },
  "00290010": { vr: "LO", Value: ["ACME"] },
  "00291001": { vr: "LO", Value: ["a"] },
  "00291002": { vr: "US", Value: [7] },
  "00311020": { vr: "UN", Value: [ArrayBuffer] }
}
```

naturalizes to

```js
{
  _vrMap: {
    "0029:ACME": { x01: "LO", x02: "US" },
    "00311020": "UN"
  },
  PatientName: { Alphabetic: "Doe^Jane" },   // PN accessors: String(v) is "Doe^Jane"
  ImageType: ["ORIGINAL"],                   // VM 2-n keeps the list
  "0029:ACME": { creator: "ACME", reservedBlock: 0x10, x01: ["a"], x02: [7] },
  "00311020": [ArrayBuffer]                  // no creator for block 0x10 of group 0031
  // aliases (non-enumerable):
  //   "00290010" -> "ACME"            (read-only)
  //   "00291001" -> ["0029:ACME"].x01 (read and write)
  //   "00291002" -> ["0029:ACME"].x02 (read and write)
}
```

A private value is a list (NAT-U-VAL-4). An assigned PN string converts:
`dataset.PatientName = "Doe^John"` stores `{ Alphabetic: "Doe^John" }`.

## § User requirements

### NAT-U-KEY — keys

- **NAT-U-KEY-1.** A standard attribute has its dictionary keyword as its
  key, for example `PatientName`.
- **NAT-U-KEY-2.** An attribute that has no dictionary entry and is not in
  a reserved block has its 8-digit hex tag as its key, for example
  `"00311020"`.
- **NAT-U-KEY-3.** An attribute that `registerTag()` registered has the
  registered keyword as its key, unless it is in a reserved block
  (NAT-U-PRIV-6).
- **NAT-U-KEY-4.** The keys `_vrMap` and `_meta` are reserved. They are not
  attributes.

### NAT-U-VAL — values

- **NAT-U-VAL-1.** An attribute whose dictionary VM is `1` or `0-1` has a
  single value. When the element is present and empty, the value is `null`.
- **NAT-U-VAL-2.** An attribute with any other VM has a list, also for one
  value. When the element is present and empty, the value is `[]`. A
  present element with no `Value` (DICOM JSON leaves it out) is empty, in
  both producers.
- **NAT-U-VAL-3.** A scalar-VM attribute with more than one value keeps the
  list.
- **NAT-U-VAL-4.** An attribute with no dictionary VM (a private or unknown
  element) follows NAT-U-VAL-2, as for VM > 1: a list, also for one value,
  and `[]` when the element is present and empty. A binary VR follows
  NAT-U-BIN-1, and a sequence follows NAT-U-SQ-1.
- **NAT-U-VAL-5.** A PN value is the component object
  (`{ Alphabetic, Ideographic, Phonetic }`), or a list of them. `String()`
  of the value gives the DICOM PN string. A PN attribute of a dataset or
  item has a converting setter: an assigned PN string (`"Doe^John"`,
  `"A^B\C^D"`), component object or list is stored in the component form,
  as one object for a VM of 1 and as a list otherwise. An assigned
  `undefined` stays `undefined`, so denaturalize omits the attribute.
  - The setter copies an assigned object, gives `null` (VM 1) or `[]` for
    `""`, and drops an empty name between two `\` delimiters.
  - A private PN element with no creator has the setter too. A PN element in
    a block converts through its alias (NAT-U-SET-2).
  - A copy of the dataset (a spread, `deepCloneInstance`) has plain values
    and no setter.
- **NAT-U-VAL-6.** An absent element has no key.

### NAT-U-SQ — sequences

- **NAT-U-SQ-1.** A sequence with one item (and a VM of 1, or no dictionary
  VM) is the item object, made array-like: it has non-enumerable `[0]` (the
  item), `length` (1) and an iterator. `seq.Field`, `seq[0].Field`,
  `seq.length === 1` and `for...of` work on it, so code that treats a
  sequence as an array keeps working. `Array.isArray(seq)` is false.
- **NAT-U-SQ-2.** A sequence with more items is a list of item objects.
- **NAT-U-SQ-3.** Each item is a naturalized dataset with its own `_vrMap`
  and its own reserved blocks.

### NAT-U-BIN — binary values

- **NAT-U-BIN-1.** A binary VR (OB, OW, OD, OF, OL, OV, UN) keeps a list of
  its fragments or frames, so `dataset.PixelData[0]` works. This includes a
  list of one, and a list of values that are not bytes (for example a UN
  element with a string `Value`). A binary element with no value is `null`,
  not `[]`, in both producers. No value includes a value whose fragments
  all have zero bytes, as a Part 10 reader gives for an empty element.
- **NAT-U-BIN-2.** By default, each fragment or frame is an `ArrayBuffer`
  that holds only the bytes of that fragment. So
  `new Uint16Array(dataset.PixelData[0])` reads the samples, as in 0.x.
- **NAT-U-BIN-3.** With the option `binaryAs: "Uint8Array"` (on
  `naturalizeDataset` and on `NaturalizedListener` / `toNaturalized`), each
  fragment or frame is a `Uint8Array` over the source bytes, and the
  producer copies no bytes. The caller must read a typed view with
  `new Uint16Array(u8.buffer, u8.byteOffset, u8.byteLength / 2)`.
  `new Uint16Array(u8)` converts each byte to one element.
- **NAT-U-BIN-4.** A value that is a reference keeps the reference:
  `{ BulkDataURI }`, or `{ InlineBinary }` when `naturalizeDataset` reads a
  DICOM JSON element that has `InlineBinary` and no `Value`.
- **NAT-U-BIN-5.** The writers accept an `ArrayBuffer`, any view (at any
  offset), or `{ InlineBinary }` for each fragment.

### NAT-U-VR — the `_vrMap` side table

- **NAT-U-VR-1.** Every naturalized dataset and every item has a `_vrMap`
  object.
- **NAT-U-VR-2.** The user can find the VR of each element whose VR the
  dictionary does not fix:
  - an element with a data-dependent VR (dictionary VR `ox`, `xs`, ...) or a
    VR that differs from the dictionary: `_vrMap[keyword]`;
  - an element with no dictionary entry: `_vrMap[hexTag]`;
  - an element in a reserved block: `_vrMap[blockKey][elementKey]`.
- **NAT-U-VR-3.** `_vrMap` holds no entry for a private creator. A private
  creator is always LO.

### NAT-U-PRIV — private data elements

- **NAT-U-PRIV-1.** A private creator and the elements of its reserved block
  naturalize to one object under the block key
  `` `${gggg}:${creator}` ``.
- **NAT-U-PRIV-2.** The block object holds `creator` (the creator string),
  `reservedBlock` (the source `xx`, as a number) and one element key `xEE`
  for each element of the block. Each of these is enumerable, so the block
  survives `JSON.stringify`.
- **NAT-U-PRIV-3.** The block key holds the group. Two groups that use the
  same creator string at the same `xx` give two different blocks.
- **NAT-U-PRIV-4.** A creator with no elements gives a block with only
  `creator` and `reservedBlock`.
- **NAT-U-PRIV-5.** A private element whose block has no creator keeps its
  8-digit hex tag as its key (NAT-U-KEY-2).
- **NAT-U-PRIV-6.** An element of a reserved block is in its block also when
  `registerTag()` registered a keyword for it. The keyword is an alias
  (NAT-U-HIST-3).
- **NAT-U-PRIV-7.** The producers apply a creator to its block also when the
  creator comes after the block elements in the source.
- **NAT-U-PRIV-8.** The block key is the authority for the creator string.
  When `block.creator` differs from the key, the key wins on write.
- **NAT-U-PRIV-9.** PS3.5 7.8.1 permits one block per creator in a group. When
  a source has the same creator for two blocks of one group, the producers
  merge the two blocks into one block and log a warning. An element number
  that is in both blocks keeps the last value. The other value is lost.
- **NAT-U-PRIV-10.** The creator string has no LO padding (leading spaces,
  trailing spaces and NULs). A creator that the source holds as bytes (UN,
  or DICOM JSON `InlineBinary`) gives the same string as an LO creator. A
  creator value that is not text or bytes (a number, a `{ BulkDataURI }`)
  is no creator: the elements of its block keep their hex tags.

### NAT-U-HIST — historical names

- **NAT-U-HIST-1.** The 8-digit hex tag of each element of a reserved block
  stays readable on the dataset, for example `dataset["00291001"]`. A write
  to that name changes the value in the block.
- **NAT-U-HIST-2.** The 8-digit hex tag of each private creator stays
  readable on the dataset, for example `dataset["00290010"]`. It is
  read-only.
- **NAT-U-HIST-3.** A `registerTag()` keyword of a block element is readable
  and writable on the dataset and in the block.
- **NAT-U-HIST-4.** A private dictionary keyword of a block element, for
  example `CSAImageHeaderInfo` for `(0029,"SIEMENS CSA HEADER",10)`, is
  readable and writable in the block only. The dataset does not get that
  name, because different creators use the same names.
- **NAT-U-HIST-5.** The historical names are not enumerable. `Object.keys`,
  `for...in`, `JSON.stringify` and the denaturalizers do not see them.
  `"00291001" in dataset` is true.
- **NAT-U-HIST-6.** A copy that keeps only enumerable properties (JSON, an
  object spread, `deepCloneInstance`) does not keep the historical names,
  and it does not keep the deletes of NAT-U-HIST-7: its blocks still hold a
  deleted element. `definePrivateAliases(dataset)` from `@dcmjs-org/core`
  adds the names again. To remove an element from a dataset that you copy
  later, delete it in the block: `delete dataset[blockKey].xEE`.
- **NAT-U-HIST-7.** A `delete` of an element alias on the dataset (the hex
  tag or the `registerTag()` keyword) removes that element from the output
  of `denaturalizeDataset` and of `fromNaturalized`. A `delete` of a creator
  alias removes the creator and every element of its block. So code that
  removes private tags by hex key (de-identification) continues to remove
  them. A delete always wins: the element is left out whatever value the
  block holds at the write, also after a rewrite of the value or a
  replaced block object. A deleted alias stays deleted, also after a call
  of `definePrivateAliases`. To add the element again, set a value on the
  deleted name: that value is a new flat element (NAT-U-RT-1). The block
  object keeps the deleted value until the write; `delete
  dataset[blockKey].xEE` removes it from the naturalized dataset too.
- **NAT-U-HIST-8.** An alias reads and writes the block that the dataset
  holds under the block key when the alias is used, also after the user
  replaces the block object. After the user deletes the block key, a write
  to an element alias makes a flat element with the VR that the block had
  for that element.

### NAT-U-RT — conversion back to DICOM

- **NAT-U-RT-1.** `denaturalizeDataset` and `fromNaturalized` accept the
  block form and the hex-tag form, also in one dataset. A flat hex-tag
  element that has no flat creator and is in the reserved range of a block
  is written in that block (for example an element that the user adds with
  `dataset["00291002"] = ...`). When the block already holds that element
  number, the flat element keeps its own tag, and the block moves.
- **NAT-U-RT-2.** naturalize, then denaturalize, then write, then read gives
  the same private creators, block elements and values as the source.
- **NAT-U-RT-3.** A block keeps its `reservedBlock` when that `xx` is free in
  the group. When the `xx` is not free, the block moves to the first free
  `xx` from `10` to `FF`. The element numbers do not change.
- **NAT-U-RT-4.** A block element with no VR in `_vrMap` gets the VR of the
  private dictionary for `(group, creator, ee)`. When no VR is available,
  the element is skipped with a warning. An element without a VR is never
  written.
- **NAT-U-RT-5.** A hex-tag element with no VR in `_vrMap` is skipped with a
  warning.
- **NAT-U-RT-6.** A block with no free `xx` in its group is skipped with a
  warning.

### NAT-U-SET — utilities to add or replace an attribute

These utilities are exported from `@dcmjs-org/core`, and from `dcmjs.data`
of `@dcmjs-org/dcmjs` (with `definePrivateAliases`). `length` is the value
count: 1 stores a single value (`null` for no value), and any other length
stores a list (`[]` for no value), as for VM > 1. Without `length`, the
dictionary VM decides (`PatientID` gives one value), and an attribute with
no dictionary VM is a list.

- **NAT-U-SET-1.** `setAttribute(dataset, key, value, { vr, length })`
  adds or replaces an attribute, for example a private or unknown element.
  A VR other than PN replaces an earlier PN setter with plain data. A
  sequence (`SQ`) stores its items by NAT-U-SQ: `[]` with no item, and the
  array-like item object for one item. A binary VR, also the dictionary
  code `ox` of `PixelData`, stores a list of fragments, or `null` with no
  bytes (NAT-U-BIN-1). Each fragment is an `ArrayBuffer` (NAT-U-BIN-2), or a
  `Uint8Array` with `{ binaryAs: "Uint8Array" }`. A PN VR goes through
  NAT-U-SET-2. The VR goes into `_vrMap` when the dictionary does not fix
  it (NAT-U-VR-2); a dictionary code such as `ox` is not a VR and is not
  recorded.
- **NAT-U-SET-2.** `setPersonName(dataset, key, value, length)` adds or
  replaces a PN attribute in the component form, with the converting setter
  of NAT-U-VAL-5, so a later assignment of a string converts too. For a
  private block element, the alias converts a later string because
  `_vrMap` gives PN for the element.
- **NAT-U-SET-3.** `setVr(dataset, key, vr)` sets the VR of an attribute in
  `_vrMap`, and creates `_vrMap` when the dataset has none.
  `setVr(dataset, blockKey, vr, elementKey)` sets the VR of a block
  element.
- **NAT-U-SET-4.** A key of these utilities can be a keyword, an 8-digit hex
  tag, or a private alias. A hex tag is uppercase, and a hex tag with a
  keyword is that keyword: `"00100020"` sets `PatientID`, and the hex tag of
  a flat `registerTag()` element sets its keyword. A creator alias is
  read-only: `setAttribute` and `setPersonName` on it throw a `TypeError`
  (change the block key to change the creator), and `setVr` on it changes
  nothing (NAT-U-VR-3). A private alias (a hex tag or a `registerTag()`
  keyword of a block element) stores into its block, and the VR goes into
  the block entry of `_vrMap`. A hex tag whose block alias was deleted
  stays a hex key, so a set on it makes a new flat element
  (NAT-U-HIST-7).

### NAT-U-PROD — the two producers

- **NAT-U-PROD-1.** `naturalizeDataset` and `NaturalizedListener` give equal
  objects (equal enumerable content, and the same historical names) for the
  same source, except for the open items in
  [Known differences](#known-differences).

## § Implementation requirements

### NAT-I-CODE — where the behaviour lives

- **NAT-I-CODE-1.** `packages/core/src/utilities/privateBlocks.js` holds the
  private-block rules. Both producers and `denaturalizeDataset` call it. A
  producer does not keep a local copy of these rules.
  - `isPrivateTag(tag)`: `Tag.isPrivateCreator()` or `Tag.isPrivateValue()`.
  - `registeredTagEntry(tag)`: the `registerTag()` entry of a hex tag.
  - `recordVr(vrMap, key, entry, vr)` in `vrMap.js`: the `_vrMap` rule
    (NAT-I-VR-1), for both producers.
  - `toPersonNameValue` and `definePersonNameAccessor` in
    `personNameValue.js`: the PN form and setter (NAT-U-VAL-5). Both
    producers define the setter for each PN attribute of a dataset or item;
    a PN element in a private block converts through its alias when
    `_vrMap` gives PN for it.
  - `valueLength(entry)` in `isMultiVM.js`: the value count of an entry
    (1 for a scalar VM, else a list), for both producers and the set
    utilities.
  - `sequenceValue`, `binaryValue` and `simpleValue` in `naturalValues.js`:
    the sequence, binary and simple value rules, for both producers and
    `setAttribute`. The listener keeps its own scalar rule only for the
    cardinality-violation policy.
  - Both producers look up a tag with the `dictionary` proxy, which gives
    `registerTag()` entries and the repeating groups (50xx, 60xx).
  - `setVr`, `setAttribute` and `setPersonName` in
    `naturalizedAttributes.js` (NAT-U-SET).
  - `placePrivateElements(target, vrMap, elements)`: places the private
    elements of one level, then calls `definePrivateAliases`.
  - `definePrivateAliases(target)`: derives every alias from the blocks.
  - `expandPrivateBlocks(dataset)`: gives a shallow view with blocks
    expanded to a creator plus hex-tag elements, and a flat `_vrMap`.
- **NAT-I-CODE-2.** `fromNaturalized` denaturalizes the dataset (and
  `_meta`) and streams the result through `fromDataSet`. It does not walk
  the naturalized form itself.

### NAT-I-PLACE — placement of private elements

- **NAT-I-PLACE-1.** A producer collects the private elements of one level
  (dataset, item, file meta) with their naturalized values, and places them
  when the level ends. `NaturalizedListener` keeps them in the object
  frame (`privates`) until `endItem`, `endDataSet` or
  `endFileMetaInformation`.
- **NAT-I-PLACE-2.** The creators of a level are found first, so the order
  of the source does not matter (NAT-U-PRIV-7).
- **NAT-I-PLACE-3.** A creator with an empty value is not a creator. Its
  element keeps its hex tag. A creator value that holds bytes (UN, or an
  `{ InlineBinary }` with base64 or bytes) decodes with the latin1 decoder of
  core, from the first 64 bytes only (the LO maximum), so a malformed large
  value cannot stop the naturalizer. Denaturalize writes the creator as LO.
- **NAT-I-PLACE-4.** The blocks come after the standard attributes in key
  order.
- **NAT-I-PLACE-5.** Each producer shapes values with its own rules before
  placement (NAT-U-VAL), and placement does not change a value.

### NAT-I-BIN — binary fragments

- **NAT-I-BIN-1.** `naturalBinaryFragment(fragment, binaryAs)` in
  `packages/core/src/utilities/binaryFragment.js` converts each fragment for
  both producers. In the default mode, a view that covers its whole buffer
  gives that buffer with no copy. Any other view, and a `SharedArrayBuffer`,
  is copied to a new `ArrayBuffer`.
- **NAT-I-BIN-2.** `checkBinaryAs` rejects a `binaryAs` value other than
  `"ArrayBuffer"` or `"Uint8Array"` with a `TypeError`.

### NAT-I-ALIAS — aliases

- **NAT-I-ALIAS-1.** An alias is an accessor property from
  `Object.defineProperty` with `enumerable: false` and
  `configurable: true`. A dataset alias reads `dataset[blockKey]` when it is
  used. An element alias has a getter and a setter. A creator alias has a
  getter only, so a write throws `TypeError` in strict-mode code.
- **NAT-I-ALIAS-2.** An alias never replaces an own property that is
  already there.
- **NAT-I-ALIAS-3.** The private dictionary lookup uses the `dictionary`
  proxy key `(gggg,"creator",ee)`, so it works only when
  `registerPrivatesModule()` registered the private dictionary.
- **NAT-I-ALIAS-4.** `definePrivateAliases` records each dataset alias, with
  its getter, in a non-enumerable `Symbol.for("dcmjs.privateAliases")` map,
  and it never defines a recorded name again. An alias is deleted when the
  own property is gone, or when its getter is no longer the recorded one (a
  plain value replaced it). `expandPrivateBlocks` leaves out the block of a
  deleted creator alias and the element of a deleted element alias, with
  no check of the value. A left-out element does not hold its number in
  the block. `fromNaturalized` denaturalizes the dataset itself, not a copy,
  so the record applies.

### NAT-I-VR — the `_vrMap` rules

- **NAT-I-VR-1.** Both producers record `_vrMap[key] = vr` for a standard
  element when the dictionary VR is `ox` or differs from the element VR, and
  for an element with no dictionary entry. `NaturalizedListener` skips an
  event with no VR.
- **NAT-I-VR-2.** `expandPrivateBlocks` copies the flat `_vrMap` entries,
  adds `LO` for each creator, and adds the VR of each block element under
  its new hex tag.

### NAT-I-RT — block number assignment

- **NAT-I-RT-1.** The used block numbers of a group are the `xx` of each
  flat private creator and of each flat private element in that group that
  does not join a block (NAT-U-RT-1). A flat key is an 8-digit hex key, or a
  `registerTag()` keyword of a private tag.
- **NAT-I-RT-2.** The first pass gives each block its `reservedBlock` when
  that number is free. The second pass gives the remaining blocks the first
  free number. So a block that must move never takes the number of a block
  that can stay.

## Known differences

These are open items against NAT-U-PROD-1. They are older than the private
block form, and they apply to standard attributes too.

- **Fragment grouping.** For encapsulated pixel data, the number of entries
  in the binary list depends on the source. `fromPart10` gives the raw
  fragments when the file has no Basic Offset Table, and
  `DicomMessage.readFile` gives frames.
- **DICOM JSON `InlineBinary`.** `naturalizeDataset` keeps
  `{ InlineBinary: base64 }` (NAT-U-BIN-4). `fromDicomWebJson` into
  `NaturalizedListener` decodes the base64 to a list of one fragment.
- **Precision retention.** `NaturalizedListener` keeps the source string of
  an IS or DS value that a JavaScript number cannot reproduce.
  `naturalizeDataset` keeps the value as the dict holds it.
- **Cardinality violations.** `NaturalizedListener` applies its
  `cardinalityViolationPolicy` to a scalar-VM attribute with more than one
  value. `naturalizeDataset` keeps the list and does not warn.

## Tests

| Requirement | Test |
| --- | --- |
| NAT-U-PRIV, NAT-U-HIST-1/2/7/8, NAT-U-PROD-1 | `test/core/privateBlocks.test.js` |
| NAT-U-PRIV-9/10, NAT-U-RT-1 (flat elements) | `test/core/privateBlocks.test.js` |
| NAT-U-RT-3, NAT-U-RT-4 | `test/core/privateBlocks.test.js` |
| NAT-U-RT-2 (writer path) | `test/core/privateBlocks.test.js` |
| NAT-U-HIST-3, NAT-U-RT-2 | `test/issues/issue388-private-tags.test.js` |
| NAT-U-HIST-4, NAT-U-PRIV-5 | `test/eventStream/NaturalizedListener.test.js` |
| NAT-U-BIN-1/2/3, NAT-U-PROD-1 (binary) | `test/core/binaryValues.test.js` |
| NAT-U-VAL-5 (PN setter), NAT-U-SET | `test/core/naturalizedAttributes.test.js` |
| NAT-U-VAL, NAT-U-SQ | `test/core/naturalizeDataset.test.js`, `test/issues/issue218-single-item-sq.test.js` |
