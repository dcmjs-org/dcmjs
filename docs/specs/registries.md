# Registries specification

## Scope

This specification gives the user requirements of the registries of dcmjs
1.0: the value representations (VRs), the SOP classes, and the character
sets. It also gives the user requirements of the constructors of the byte
streams, because the same change made them.

A developer uses a registry to look up a known entry by name, and to add an
entry that dcmjs does not know, without a fork of dcmjs.

The implementation requirements are in a separate document:
[registries-implementation.md](registries-implementation.md). An
implementation requirement cites the user requirement that it satisfies. A
user requirement does not cite an implementation requirement.

**Change rule.**

- You change a user requirement (`REG-U-n`) in two cases only: the
  requirement describes the behaviour wrongly, or the intended user-facing
  behaviour changes. An implementation that is inconvenient is not a reason
  to change a user requirement.
- A change to a user requirement also needs an entry in
  `docs/MIGRATION.md`.
- You can change an implementation requirement (`REG-I-n`) when a better
  approach appears. See the change rule in
  [registries-implementation.md](registries-implementation.md).

## Terms

| Term | Meaning |
| --- | --- |
| Registry | A named set of entries that dcmjs reads, and that a developer can extend at run time. |
| Defined term | A value of Specific Character Set (0008,0005), for example `ISO_IR 100` (PS3.3 C.12.1.1.2). |
| Single-byte character set | A character set that holds each character in one byte, for example `ISO_IR 100` (Latin-1). |
| Legacy constructor form | The positional constructor arguments of the byte streams in dcmjs 0.x. |

## § User requirements

### Value representations

- **REG-U-1.** A developer can get the VR object of a VR code by property
  access on one exported constant, for example the `DS` property.
- **REG-U-2.** A developer can add a VR code that dcmjs does not support,
  or replace a supported one, from outside dcmjs. After the addition, a
  read of a file with that VR uses the added VR object, and dcmjs gives no
  "invalid VR" warning for that code.
- **REG-U-3.** A developer can give the classification of an added VR: a
  binary number, a 32-bit length, a value that is never split on a
  backslash, and a byte stream. Each check of dcmjs that uses one of these
  classifications gives the same answer for the added VR.
- **REG-U-4.** The VR lists that dcmjs exported before the registry keep
  their names, their types, and their members. One exception: the list of
  VRs that a reader never splits on a backslash also has ST, UT and UR,
  because these VRs have one value (PS3.5 6.2). A VR that a developer adds
  appears in each list that its classification selects.

### SOP classes

- **REG-U-5.** A developer can get a SOP Class UID by name with property
  access on one exported constant, for example the `CTImage` property.
  The constant is a plain object.
- **REG-U-6.** A developer can get the name of a SOP Class UID.
- **REG-U-7.** A developer can add a SOP class name and UID from outside
  dcmjs. The name and the UID are then available through REG-U-5,
  REG-U-6, and the two existing SOP class maps of the metadata dictionary.
- **REG-U-8.** The two existing SOP class maps of the metadata dictionary
  (UID by name, name by UID) keep property access. Code that adds an
  entry to the map of names by UID, and then asks the dictionary to
  rebuild the map of UIDs by name, keeps its result.

### Character sets

- **REG-U-9.** A developer can add a defined term that dcmjs does not
  know, for example a vendor spelling of `ISO_IR 100`, with a decode
  function and an encode function. A read of a dataset that declares the
  term decodes its text with the added decode function. A write encodes
  with the added encode function.
- **REG-U-10.** A write encodes the text of a dataset with the character
  set that the dataset declares in Specific Character Set (0008,0005). For
  example, a dataset that declares `ISO_IR 100` gets the byte `0xE9` for
  `é`, and a read of the written file gives the same text.
- **REG-U-11.** A Specific Character Set in a sequence item applies to
  that item only. The next item, and the elements after the sequence, use
  the character set of their own dataset.
- **REG-U-12.** A dataset with no Specific Character Set is written as
  before: the text is UTF-8 bytes. A dataset that declares the default
  repertoire, with an empty value or with `ISO 2022 IR 6`, is written with
  the windows-1252 table, the same table that the read uses. DICOM defines
  the default repertoire as ASCII, but windows-1252 is the common handling
  of an unspecified repertoire, so the text that dcmjs reads from such a
  file writes back unchanged.
- **REG-U-13.** A write of a character that a single-byte character set
  cannot hold fails with an error that names the character and the
  character set. When the write options ask to ignore errors, the writer
  writes `?` for that character. Exception: `ISO_IR 100` uses the
  windows-1252 table, the same table that the read uses, so the characters
  that windows-1252 puts at 0x80 to 0x9F (for example `€`, `—`, `“`) write
  without an error. The read and the write then stay symmetric. Other
  toolkits read those bytes as ISO 8859-1 control characters.
- **REG-U-14.** A declared character set that has no encoder in dcmjs
  (multi-byte character sets, ISO 2022 code extensions, and a multi-valued
  Specific Character Set) is written as UTF-8 bytes, as before. dcmjs
  logs one warning for each such character set. This is a known limit:
  the file then has text that does not agree with its declared character
  set.
- **REG-U-15.** A read still changes the value of Specific Character Set
  (0008,0005) to `ISO_IR 192`, because the read gives text and not bytes.

### Byte streams

- **REG-U-16.** A developer creates a read stream with a buffer and one
  options object, and a write stream with one options object. The byte
  order is an option, and little endian is the default.
- **REG-U-17.** A call with the legacy constructor form keeps working, and
  keeps all of its arguments: the byte order, the size hint, the start and
  stop offsets, the no-copy option, and the clear-buffers option. A legacy
  call gives the same byte order as in dcmjs 0.x, also when it gives an
  explicit empty byte order (for example `undefined` or `0`). dcmjs logs one warning for each stream class that gets a
  legacy call.

### Tags

- **REG-U-18.** A developer can register a tag with a name, a VR and a VM
  through `dcmjs.data.registerTag`. The developer can give the tag in upper
  case or in lower case. A read gives the registered name as the key, and
  a write of that name gives the registered tag.
- **REG-U-19.** A registered name that is an existing keyword of a
  different tag is an error. The registration of a keyword for its own tag
  is accepted with no warning.
- **REG-U-20.** When two tags are registered with one name, the first tag
  keeps the name, and a warning names both tags. A read and a write keep
  the value of each tag. The second tag has its hex tag as its key.
- **REG-U-21.** `cleanTags()` and `tagAsIntegerFromName()` find a
  registered name.

## Related documents

- [registries-implementation.md](registries-implementation.md): the
  implementation requirements.
- [../MIGRATION.md](../MIGRATION.md): the migration note for the stream
  constructors.
