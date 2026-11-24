# dcmjs 1.0: naturalized values

`naturalizeDataset` and `denaturalizeDataset` keep their names in 1.0, but
some values have a different shape. This codemod rewrites the code where the
new shape is certain, and reports the other sites.
[specs/naturalized-dataset.md](https://github.com/dcmjs-org/dcmjs/blob/master/docs/specs/naturalized-dataset.md)
gives the rules (`NAT-U-*`).

```sh
npx codemod @dcmjs-org/dcmjs-1-naturalized-values --dry-run
```

## What it changes

| 0.x code                                   | 1.0 code                                               | Why                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ds.ReferencedSeriesSequence.forEach(...)` | `Array.from(ds.ReferencedSeriesSequence).forEach(...)` | A sequence with one item is the item object, not an array (NAT-U-SQ-1). The rewrite applies to a keyword that ends with `Sequence`, and to the array methods that read.                                    |
| `ds.PatientName === "Anonymous"`           | `String(ds.PatientName) === "Anonymous"`               | A single PN value is the component object `{ Alphabetic }` (NAT-U-VAL-5). The rewrite applies to a compare with a string, and to a string method (`split`, `toUpperCase`, ...), on a PN keyword with VM 1. |
| `ValueRepresentation.addTagAccessors(ds)`  | `ds`                                                   | The call is a no-op in 1.0. A statement that only makes the call is removed.                                                                                                                               |

`ds.PatientName[0].Alphabetic`, `ds.PatientName.Alphabetic`, `seq[0].Field`,
`seq.Field`, `seq.length` and `for...of` work in 1.0 and do not change.

## What it reports

`dcmjs-1-manual`, a site that a person must change:

-   `<Keyword>: a list VM keeps the list for one value`: a keyword whose VM is
    a range (for example `WindowCenter`, `ImageType`, `SpecificCharacterSet`),
    used as one number or one string: in `Number()`, in arithmetic, in a
    template, in a compare with a literal, or with a string method. 0.x gave
    `40`, and 1.0 gives `[40]`. Only a file that imports dcmjs or calls
    `naturalizeDataset` or `toNaturalized` is checked.
-   `<Keyword>.push: a sequence with one item is not an array`: an array
    method that changes the sequence. Assign a new list:
    `ds.ContentSequence = [...Array.from(ds.ContentSequence ?? []), item]`.
-   `<Keyword>?.forEach: ...`: a read method after `?.`. Use
    `Array.from(ds.X ?? [])` where an absent sequence must act as empty.
-   `Array.isArray(<Keyword>)`: a sequence or a PN value with one item is not
    an array in 1.0. Use `Array.from(value)`.
-   `typeof <Keyword>`: a PN value is an object. Use `String(value)`.
-   `nameMap write`: 1.0 denaturalizes `registerTag()` keywords. Remove the
    write to `DicomMetaDictionary.nameMap`.
-   `<gggg00xx>: the alias of a private creator is read-only`: a write to the
    hex key of a private creator throws a `TypeError` in strict-mode code.
    Change the block key (`ds["0029:ACME"]`) to change the creator.

`dcmjs-1-review`, a site where 1.0 changes what the code does:

-   `denaturalizeDataset: private elements are kept`. 0.x dropped each
    element that is not in the dictionary. 1.0 keeps private elements. Check
    that each write path removes the private data that it must not write.
    `delete ds["00291001"]` and `delete ds["00290010"]` on the dataset still
    remove the element and the block.
-   `Object.keys(_vrMap)` and `for...in _vrMap`: `_vrMap` holds a hex-tag key
    for each element with no dictionary entry, and an object (not a string)
    for each private block.
-   `a hex-tag pattern`: a regular expression for 8-digit hex keys. The
    elements of a private block are under the block key (`"0029:ACME"`), and
    their hex keys are not enumerable.

## What it cannot find

-   An empty value changed shape: a present and empty VM 1 attribute is
    `null` (0.x: `[]`), a binary attribute with no value is `null` (0.x: `[]`),
    and a list attribute with no `Value` in DICOM JSON is `[]` (0.x: `null`).
    Use a test that is true for each form:
    `value == null || value.length === 0`.
-   A value that the code reads through a variable or a computed key, for
    example `ds[keyword]`.
-   A spread or a JSON copy of a dataset, followed by a `delete` of a private
    hex key on the copy. The copy does not keep the delete. Delete in the
    block: `delete copy["0029:ACME"].x01`.
-   The optional clean-ups: a filter of `null` entries before
    `denaturalizeDataset` (1.0 writes an empty value), `setAttribute` in place
    of a `_vrMap` write, `frameDataset` in place of a local merge of the
    functional groups, and a copy of a binary fragment after the read.

## Keywords

`scripts/keywords.ts` holds the keywords of the dictionary with a range VM,
and the PN keywords with VM 1. `pnpm run generate-keywords` in
`packages/codemods` writes it again from the dcmjs dictionary.
