# CM-2: adapt the code to the naturalized values of 1.0

Phase 1. Partly automatic. Apply after [CM-1](01-package-name.md).

`naturalizeDataset` and `denaturalizeDataset` keep their names and their
arguments, but some values have a different shape.
[MIGRATION.md](../MIGRATION.md) ("Naturalization: six changes") explains each
change, and [specs/naturalized-dataset.md](../specs/naturalized-dataset.md)
gives the rules (`NAT-U-*`). This codemod lists the code patterns that the
changes break, and the rewrite for each pattern.

The rewrites of steps 2.1, 2.2, 2.3 and 2.5 also work on 0.x. So you can
apply them before CM-1, and test the result on 0.x first. Test the `String()`
rewrite of step 2.4 on 1.0.

## Find the value multiplicity of a keyword

Steps 2.1 and 2.6 need the dictionary VM of a keyword. A tool reads it from
the dictionary:

```js
import dcmjs from "@dcmjs/dcmjs";
const { nameMap } = dcmjs.data.DicomMetaDictionary;
nameMap.WindowCenter.vm; // "1-n": a list
nameMap.PatientID.vm; // "1": a single value
```

A VM of `"1"` or `"0-1"` gives a single value. Any other VM gives a list
(NAT-U-VAL-1, NAT-U-VAL-2).

## 2.1 A list VM with one value stays a list

0.x changed every list of one value to the value. 1.0 keeps the list when the
VM is not `1` or `0-1`.

| Attribute                          | 0.x            | 1.0              |
| ---------------------------------- | -------------- | ---------------- |
| `WindowCenter` (VM 1-n), one value | `40`           | `[40]`           |
| `ImageType` (VM 2-n), one value    | `"ORIGINAL"`   | `["ORIGINAL"]`   |
| `SpecificCharacterSet` (VM 1-n)    | `"ISO_IR 100"` | `["ISO_IR 100"]` |

**Detect.** A read of a keyword whose VM is a list, where the code uses the
value as a scalar: arithmetic, `Number(...)`, `parseFloat(...)`, a string
method (`.split`, `.trim`, `.toUpperCase`), a template literal, or a
comparison with `===` to a number or a string. Typical keywords:
`WindowCenter`, `WindowWidth`, `WindowCenterWidthExplanation`, `ImageType`,
`SpecificCharacterSet`, `OtherPatientIDs`, `ReferencedFrameNumber`,
`FrameIncrementPointer`, `OperatorsName`, `ScanOptions`.

**Transform.** Take the first value explicitly:

```diff
-const center = Number(ds.WindowCenter);
+const center = Number(Array.isArray(ds.WindowCenter) ? ds.WindowCenter[0] : ds.WindowCenter);
```

Phase 2 can use `toFloatFirst` and `toStringFirst` of `@dcmjs/core` in place
of the inline test.

Do not change code that already tests `Array.isArray(...)` on the value. That
code works on 0.x and on 1.0.

**Review.** A value that the code writes back with an assignment
(`ds.ImageType = "DERIVED"`) is correct in 1.0 too: denaturalize accepts a
scalar for a list VM. A comparison of a whole list (`ds.ImageType ===
"ORIGINAL\\PRIMARY"`) needs a person, because the 0.x value was a list for
two or more values too.

## 2.2 An empty single value is `null`; an empty list is `[]`

| Element                                            | 0.x    | 1.0    |
| -------------------------------------------------- | ------ | ------ |
| VM 1, present and empty (`ReferringPhysicianName`) | `[]`   | `null` |
| list VM, present, no `Value` in DICOM JSON         | `null` | `[]`   |
| binary VR, present and empty                       | `[]`   | `null` |

**Detect.** A test for an empty value: `.length === 0`, `!x.length`,
`x === null`, `x == null`, `Array.isArray(x) && x.length`, on a naturalized
attribute.

**Transform.** Use one test that is true for each empty form:

```diff
-if (ds.ReferringPhysicianName.length === 0) {
+if (ds.ReferringPhysicianName == null || ds.ReferringPhysicianName.length === 0) {
```

An absent element still has no key (NAT-U-VAL-6). A test for `in` or
`=== undefined` does not change.

## 2.3 A sequence with one item is not an array

0.x gave an array with accessors, so `Array.isArray(seq)` was `true`. 1.0
gives the item object, with a non-enumerable `[0]`, a `length` of 1 and an
iterator (NAT-U-SQ-1). `seq.Field`, `seq[0].Field`, `seq.length`, `for...of`,
`[...seq]` and `Array.from(seq)` work.

**Detect.** On a value whose keyword ends with `Sequence`, or whose `_vrMap`
VR is `SQ`:

-   `Array.isArray(seq)`;
-   an array method: `.map`, `.forEach`, `.filter`, `.find`, `.some`,
    `.every`, `.reduce`, `.slice`, `.concat`, `.push`, `.splice`, `.indexOf`;
-   `JSON.stringify(seq)` or a deep compare against an array.

**Transform.** Convert to an array before the array call. `Array.from` copies
an array of two or more items, and converts the item object of one item:

```diff
-ds.ReferencedSeriesSequence.forEach(series => use(series));
+Array.from(ds.ReferencedSeriesSequence ?? []).forEach(series => use(series));

-ds.ContentSequence.push(item);
+ds.ContentSequence = [...(ds.ContentSequence ?? []), item];

-const items = Array.isArray(seq) ? seq : [seq];
+const items = Array.from(seq);
```

**Review.** A `push` onto a sequence that other code holds by reference.
The rewrite replaces the value, so the other reference does not see the new
item. Find the other references, and update each one after the rewrite.

## 2.4 A single person name is the component object

0.x gave a list with accessors: `ds.PatientName[0].Alphabetic` and
`ds.PatientName.Alphabetic` both worked. 1.0 gives the component object
(NAT-U-VAL-5): `ds.PatientName[0]` is `undefined`. `String(ds.PatientName)`
gives the DICOM PN string in both versions.

An assignment of a string converts at once: after
`ds.PatientName = "Doe^John"`, the value is `{ Alphabetic: "Doe^John" }`.

**Detect.** On a keyword with the VR PN and a VM of 1, for example
`PatientName` and `ReferringPhysicianName`. A PN keyword with a list VM (for
example `PerformingPhysicianName`, VM 1-n) is a list of component objects
(step 2.1).

-   `ds.PatientName[0]`;
-   `typeof ds.PatientName === "string"`;
-   a compare with a string: `ds.PatientName === "Doe^John"`;
-   a string method on the value: `.split("^")`, `.toUpperCase()`, `.includes`.

**Transform.**

```diff
-const family = ds.PatientName[0].Alphabetic.split("^")[0];
+const family = String(ds.PatientName).split("^")[0];

-if (ds.PatientName === "Anonymous") {
+if (String(ds.PatientName) === "Anonymous") {
```

`String(...)` gives the full PN string, with the `=` delimiters of the
ideographic and phonetic groups. Use `ds.PatientName.Alphabetic` when the code
needs the alphabetic group only.

**Review.** A spread or a `deepCloneInstance` copy of the dataset has plain
values and no PN setter. On the copy, an assigned string stays a string.

## 2.5 Private elements: block keys, and a round trip that keeps them

Two changes affect private data:

-   A private creator and its elements naturalize to one block key
    (`"0029:ACME"`), with element keys `xEE` (NAT-U-PRIV). The 8-digit hex keys
    stay as non-enumerable aliases (NAT-U-HIST).
-   `denaturalizeDataset` keeps private elements. 0.x dropped each element that
    was not in the dictionary, with the log "Unknown name in dataset".

**Detect.**

-   `Object.keys(ds)`, `for...in`, `Object.entries(ds)` or `JSON.stringify(ds)`
    with a filter for hex keys (`/^[0-9A-F]{8}$/i`) or for odd groups. These no
    longer see the hex keys of block elements.
-   An assignment to a creator hex key (`ds["00290010"] = ...`). The alias is
    read-only, and the write throws `TypeError` in strict-mode code.
-   An object spread or a JSON copy of the dataset, followed by a `delete` of a
    hex key on the copy.
-   `naturalizeDataset` then `denaturalizeDataset`, with no explicit removal of
    private tags, in code that must not write private data (de-identification,
    export to a third party).

**Transform.**

```diff
-const privateKeys = Object.keys(ds).filter(k => /^[0-9A-F]{8}$/.test(k) && parseInt(k.slice(0, 4), 16) % 2);
+const privateKeys = Object.keys(ds).filter(k => /^[0-9A-F]{4}:/.test(k) || (/^[0-9A-F]{8}$/.test(k) && parseInt(k.slice(0, 4), 16) % 2));

-ds["00290010"] = "ACME";
+// change the block key to change the creator
+ds["0029:ACME"] = { ...ds["0029:OLD"], creator: "ACME" };
+delete ds["0029:OLD"];
```

A `delete ds["00291001"]` and a `delete ds["00290010"]` on the dataset still
remove the element and the block (NAT-U-HIST-7). Keep that code. When the
code deletes on a copy, delete in the block: `delete copy["0029:ACME"].x01`.

**Review.** This is the step with the highest risk. Code that depended on the
0.x loss of private data now writes private data. Find each write path of the
project (Part 10, DICOMweb STOW, export), and confirm that each one removes
private data where the project requires it. Add a test that writes a file with
a private element and checks the output.

Code that counts or iterates `_vrMap` keys sees new entries: a hex key for an
element with no dictionary entry, and an object (not a string) for each block
key (NAT-U-VR-2). Code that reads `_vrMap[key]` as a string must skip the
object entries.

## 2.6 Remove the workarounds that 1.0 makes unnecessary

These rewrites are optional. Each one removes code that 1.0 does not need.
Apply them after the tests pass.

| 0.x workaround                                                                                                                | 1.0 rewrite                                                                  | Rule                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| A write to `DicomMetaDictionary.nameMap` so that `denaturalizeDataset` finds a `registerTag()` keyword                        | Remove the write                                                             | MIGRATION change 3                                 |
| A filter that removes `null` entries from a value list before `denaturalizeDataset`                                           | Remove the filter: a `null` entry writes an empty value                      | NAT-U-RT-7                                         |
| `ValueRepresentation.addTagAccessors(ds)`                                                                                     | Remove the call: it is a no-op                                               | MIGRATION change 5                                 |
| `ds._vrMap.X = vr; ds.X = value`                                                                                              | `dcmjs.data.setAttribute(ds, "X", value, { vr })`                            | NAT-U-SET-1                                        |
| A local merge of `PerFrameFunctionalGroupsSequence` and `SharedFunctionalGroupsSequence` (for example `combineFrameInstance`) | `dcmjs.data.frameDataset(ds, frameNumber)`                                   | NAT-U-FRAME, [frameDataset.md](../frameDataset.md) |
| A copy of a binary fragment to a new `ArrayBuffer` after the read                                                             | Remove the copy: each fragment is an `ArrayBuffer` that holds only its bytes | NAT-U-BIN-2                                        |

These rewrites do not work on 0.x.

## Verify

-   The tests of the project pass.
-   For each test fixture, compare the output of the project on 0.x and on 1.0.
    A difference must match a step above. A difference in private data must
    match a decision in step 2.5.
-   `LOG_LEVEL=warn` shows no new warning from the write path. A warning
    "skipped" from denaturalize means an element with no VR (NAT-U-RT-4,
    NAT-U-RT-5): set the VR with `setVr`.
