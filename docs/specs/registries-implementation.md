# Registries implementation specification

## Scope

This document gives the implementation requirements of the registries of
dcmjs 1.0 (VRs, SOP classes, character sets) and of the byte stream
constructors. The user requirements are in
[registries.md](registries.md). Each implementation requirement cites the
user requirement (`REG-U-n`) that it satisfies.

**Change rule.** You can change an implementation requirement (`REG-I-n`)
when a better approach appears. Keep each user requirement of
[registries.md](registries.md) true after the change. A change that makes a
user requirement false is a change to the user requirement, and follows the
change rule of [registries.md](registries.md).

All paths are in `packages/core/src` unless the requirement gives a
different path.

## § Implementation requirements

### Value representations

- **REG-I-1.** `ValueRepresentation.js` exports `Vrs`, a plain object of
  VR code to VR instance (`Vrs.DS`). `Vrs` replaces the private
  `VRinstances` table. `createByTypeString(type)` reads `Vrs` with an own
  property check. (REG-U-1, REG-U-2)
- **REG-I-2.** `registerVr(code, vr, flags?)` sets `Vrs[code] = vr`, adds
  `code` to `VALID_VRS`, stores the flags, and returns `vr`. Without
  `flags`, the flags come from the instance (`isBinary()`, `isLength32()`,
  `allowMultiple()`) and the existing `readSingle` and `byteStream` flags of
  the code. The writer writes `vr.type` as the VR, so the instance must
  have `type === code`. (REG-U-2, REG-U-3)
- **REG-I-3.** `constants/vrs.js` holds the one seed table of flags
  (`VrFlags`: `binary`, `length32`, `single`, `readSingle`, `byteStream`).
  The `ValueRepresentation` constructor copies the flags of its code to
  `_isBinary`, `_isLength32` and `_allowMultiple`; `isBinary()`,
  `isLength32()` and `allowMultiple()` read these. `ParsedUnknownValue`
  keeps its fixed flags. (REG-U-3)
- **REG-I-4.** `singleVRs` (re-exported by `constants/dicom.js`) and
  `BINARY_VRS` (re-exported by `utilities/binaryVRs.js`) are computed from
  the seed table. `setVrFlags` recomputes them in place, so the exported
  array and Set objects stay the same. The members at load are the members
  before the registry: `singleVRs` = SQ OF OW OB UN LT, `BINARY_VRS` = OB
  OD OF OL OV OW UN. The order of `singleVRs` changed; every consumer uses
  `indexOf`. (REG-U-4)
- **REG-I-5.** The seed table keeps the members of the 0.x lists exactly:
  `isBinary()` for FL FD SL SS UL US AT UV; `isLength32()` for OB OW OF OL
  SQ UC UR UT UN OD UV; `allowMultiple()` false for SQ OF OL OW OB UN and
  the binary VRs. dcmjs 1.0 has no OV or SV class; OV has the `byteStream`
  flag only. (REG-U-4)
- **REG-I-6.** `VALID_VRS` and `BULKDATA_VRS` keep their hand-kept members.
  `registerVr` adds a new code to `VALID_VRS`, so the explicit VR readers
  accept it. (REG-U-2)
- **REG-I-7.** The JSDoc typedefs `VrRegistry` and `VrFlags` describe the
  shapes, so a TypeScript port can declare `interface VrRegistry` and let
  a caller merge new members. (REG-U-1)

### SOP classes

- **REG-I-8.** `constants/sopClasses.js` exports `SopClasses` (name to
  UID), `registerSopClass(name, uid)` and `sopClassName(uid)`. It uses
  plain objects only: a `Map` breaks `obj.Name` callers, for example
  `MeasurementReport` in the Cornerstone3D adapters. (REG-U-5, REG-U-6,
  REG-U-7)
- **REG-I-9.** `DicomMetaDictionary.sopClassUIDsByName` is the `SopClasses`
  object, and `DicomMetaDictionary.sopClassNamesByUID` is the reverse
  object of `constants/sopClasses.js`. `_generateUIDMap()` calls
  `registerSopClass` for each entry of `sopClassNamesByUID`. It adds
  entries and does not replace the object. (REG-U-7, REG-U-8)
- **REG-I-10.** The JSDoc typedef `SopClassRegistry` lists the names, for a
  TypeScript `interface` with merging. (REG-U-5)

### Character sets

- **REG-I-11.** `charset/registry.js` exports
  `registerCharacterSet(term, { label?, createDecoder?, encode? })`. The
  term is normalized as for a read (`ISO_IR 100` gives `iso-ir-100`). A
  `label` is a WHATWG Encoding label; the registry builds the decoder and
  the encoder from it. A given `createDecoder` or `encode` replaces the
  built one. `encodingMapping[term]` becomes the label, or `null` when no
  label is given. (REG-U-9)
- **REG-I-12.** The registry reads `encodingMapping` at lookup time for a
  term that was not registered, so `encodingMapping` stays the seed and a
  direct edit of it still works. `encodingMapping` stays a plain object.
  (REG-U-9)
- **REG-I-13.** The encoder of a label: `TextEncoder` for UTF-8; for a
  single-byte encoding, a reverse table of the `TextDecoder` of the label
  over the bytes 0x00 to 0xFF (the lowest byte wins for a duplicate
  character); none for shift_jis, euc-jp, iso-2022-jp, euc-kr, gbk,
  gb18030, big5 and UTF-16. Note that the WHATWG `latin1`
  label is windows-1252, the same table that the read uses. (REG-U-10,
  REG-U-14)
- **REG-I-14.** A single-byte encoder throws an `Error` that names the
  character (and its code point) and the label for a character that is not
  in the table. With `writeOptions.ignoreErrors`, it writes `?` (0x3F).
  (REG-U-13)
- **REG-I-15.** `createCharacterSetEncoder(values, writeOptions)` gives the
  encoder of a (0008,0005) value list. A multi-valued list, an unknown
  term, or a term with no encoder gives the UTF-8 `TextEncoder`, and logs
  one warning for each term. (REG-U-14)
- **REG-I-16.** `resolveCharsetDecoder` (charset/iso2022.js) looks up each
  term in the registry, so every read path (DicomMessage,
  AsyncDicomReader, the parser `decodeCore`) decodes a registered term.
  The read still rewrites (0008,0005) to `["ISO_IR 192"]`. (REG-U-9,
  REG-U-15)
- **REG-I-17.** `BufferStream.encoder` is the text encoder of a stream;
  `writeUTF8String` calls `encoder.encode`. The default is the UTF-8
  `TextEncoder`. (REG-U-12)
- **REG-I-18.** `writeDataSet` (core/writeCore.js) keeps the encoder of the
  stream at entry. When it writes (0008,0005), it sets the stream encoder
  from the value. At exit it restores the encoder of the entry. `Tag.write`
  gives each child `tagStream` the encoder of its parent stream, so a
  sequence item inherits the encoder, and its own (0008,0005) is scoped to
  the item. (REG-U-10, REG-U-11)
- **REG-I-19.** `StreamingPart10Writer` (packages/generator) writes each
  element through a new stream. It keeps the current encoder, sets it from
  a (0008,0005) element of the body, saves it at the start of an item, and
  restores it at the end of the item. `Part10Writer` writes through
  `writePart10`, so REG-I-18 applies to it. (REG-U-10, REG-U-11)

### Byte streams

- **REG-I-20.** `new ReadBufferStream(buffer, { littleEndian = true, start,
  stop, noCopy, clearBuffers, ...rest })` and
  `new WriteBufferStream({ defaultSize, littleEndian = true })`. The
  `BufferStream` field default of `isLittleEndian` is `true`. (REG-U-16)
- **REG-I-21.** The legacy form is detected by the argument count: an
  explicit second argument of `ReadBufferStream`, or an explicit first
  argument of `WriteBufferStream`, that is not an object (`boolean`,
  `number`, `null`, `undefined`). The shim maps all arguments to the
  options object, with the 0.x byte order: a truthy value gives little
  endian, and any other value gives big endian, as in 0.x.
  `log.warn` runs once per class. `new ReadBufferStream(buffer)` and
  `new WriteBufferStream()` are the new form. (REG-U-17)
- **REG-I-22.** All callers in `packages/*/src` use the options form.
  `BufferStream.more()` keeps its decoder behaviour. (REG-U-16)

## Tests

- `test/core/registries.test.js`: the legacy 3-argument
  `ReadBufferStream` keeps start and stop; `WriteBufferStream(n, false)` is
  big endian (REG-U-17); `registerVr` makes an unknown VR decode with the
  registered instance (REG-U-2); `SopClasses`, `registerSopClass` and
  `DicomMetaDictionary.sopClassUIDsByName` (REG-U-5 to REG-U-8); the
  `ISO_IR 100` write and read (REG-U-10); a registered term round trip
  (REG-U-9); an item-level character set that does not leak (REG-U-11).
