# @dcmjs-org/core

The shared building blocks every other dcmjs package uses: the DICOM value
types (`ValueRepresentation`), tags (`Tag`), buffer machinery (`BufferStream`,
`SplitDataView`), character-set handling (`src/charset/`), the DICOM constants,
the runtime data dictionary, and the naturalization rules
(`DicomMetaDictionary`). No readers or writers live here.

The package deliberately has no dependency on any other dcmjs package: the
legacy engines, the streaming reader, and the writers all build on top of it,
never the other way around. Its only runtime dependencies are `pako` and
`loglevel`.

`src/index.js` exports the public surface. The packed dictionary data files
(`dicom.packed.js`, `dictionary.private.data.js`, `dictionary.ranges.data.js`)
are internal: their export names collide by design (each is a module-shaped
data blob), so they are reachable by direct module path but are not re-exported
from the index.

During the 1.0 beta this package is marked private; the publish flag flips when
the workspace layout settles, per RELEASE_PLAN.md.

## Instance creation

`createInstance(options)` creates a naturalized instance. The builders of the
other packages call it, and then set their payload:

-   `encapsulate` (`@dcmjs-org/encapsulated`) is the reference builder. Its
    package-specific requirements are ENC-USR-n and ENC-IMP-n.
-   `buildImageDataset` (`@dcmjs-org/imaging`): IMG-USR-n and IMG-IMP-n.
-   `buildVideoDataset`, `encapsulateVideo`, and `createVideoEventSource`
    (`@dcmjs-org/video`): VID-USR-n and VID-IMP-n.

The requirements below apply to `createInstance` and to each builder. A
builder README refers to these identifiers, and does not repeat them.

```js
const next = createInstance({
    baseDicom: [defaultInstanceBase, { Modality: "OT" }],
    instance: priorInstanceInSeries,
    dataLevel: "series",
    SeriesDescription: "Annotations"
});
```

### Scope and change rule

The user requirements (CORE-USR-n) say what a caller can rely on. Change a
user requirement in two cases only: the requirement describes the behaviour
wrongly, or the intended user-facing behaviour changes. The pull request must
name each changed user requirement. An implementation that is inconvenient is
not a reason to change a user requirement.

The implementation requirements (CORE-IMP-n) describe the current approach.
You can change them freely when a better approach appears.

Do not renumber an identifier. A new requirement gets the next free number.

### § User requirements

-   **CORE-USR-1** Every builder takes the same options:
    -   the `createInstance` options `baseDicom`, `instance`, `dataLevel`,
        `levels`, and `predecessor`;
    -   DICOM attribute overrides;
    -   its own control keys, for example `mimeType`, `derivedFrom`, or
        `fragmentBytes`. The builder README lists them.
-   **CORE-USR-2** Without `instance`, the result is a new object: a new
    study, series, and SOP instance, the current date and time, and empty
    Type 2 attributes.
-   **CORE-USR-3** `instance` says where the new object goes. The attributes
    of `dataLevel` and of each level above it come from `instance`. The levels
    below `dataLevel` are new.
    -   `patient`: the same patient, in a new study.
    -   `study` (the default): the same study, in a new series.
    -   `series`: the same series (its UID, number, and description), as a new
        SOP instance.
    -   There is no `instance` level. An instance attribute, for example a
        specific `SOPInstanceUID`, is an override.
    -   When an inherited study has no `StudyDate` or `StudyTime`, the value
        is `""` (Type 2 empty). When an inherited series has no
        `SeriesNumber`, the value is `""`.
-   **CORE-USR-4** The result never gets the identity of `instance`:
    `SOPInstanceUID`, `SOPClassUID`, `InstanceNumber`,
    `MediaStorageSOPInstanceUID`, and `MediaStorageSOPClassUID`. This rule
    also applies when a custom `levels` lists these keywords. An override sets
    a value of the identity. Without an override, the base blocks set the
    identity: a new `SOPInstanceUID`, the `SOPClassUID` of the builder, and
    the `InstanceNumber` of CORE-USR-5. With `predecessor: true`, the identity
    of `instance` goes only into `PredecessorDocumentsSequence` (CORE-USR-9).
-   **CORE-USR-5** With `dataLevel: "series"` (or a deeper custom level),
    `instance` is the prior instance in the series. The new `InstanceNumber`
    is the largest `InstanceNumber` of the `instance` items in the target
    series, plus 1.
    -   The target series is the `SeriesInstanceUID` override, else the
        series of the first `instance` item.
    -   An item counts when its `SeriesInstanceUID` is the target series. An
        item without a `SeriesInstanceUID` counts only when the target series
        is the series of the first item.
    -   A value that is not an integer, that is less than 0, or that is
        outside the IS range does not count. The other items still count. A
        number, an IS string, and a one-element array are integers.
    -   The `InstanceNumber` is 1 when no value counts, when the largest value
        is 2147483647 (the IS maximum), or when the series is new. A series
        is new when `dataLevel` does not inherit the series, or when the
        `SeriesInstanceUID` override is not the series of an item.
-   **CORE-USR-6** The precedence is base blocks < inherited < overrides. An
    override always wins, except for the payload attributes that a builder
    sets after `createInstance` (see CORE-USR-13). For example, an override
    `SOPInstanceUID` sets the `SOPInstanceUID` of the result.
-   **CORE-USR-7** Only attribute keys go into the dataset: a dictionary
    keyword, a keyword from `registerTag`, a tag of 8 hexadecimal digits, or a
    key that starts with `_` (`_meta`, `_vrMap`). `createInstance` drops each
    other key and logs a warning. A builder removes its control keys before
    the call.
-   **CORE-USR-8** An `undefined` override is skipped, and the base or
    inherited value stays. A `null` or `""` override gives a Type 2 empty
    value. The builders do not invent a value: an attribute without a source
    is empty or absent.
-   **CORE-USR-9** With `predecessor: true`, the new object lists each
    `instance` in `PredecessorDocumentsSequence (0040,A360)`, when the base
    has `predecessorBase`. The default base of each builder has it. The new
    object replaces the older ones, and the older objects do not change. Use
    `dataLevel: "series"` to put the new version in the series of the old
    one. Each `instance` must have `StudyInstanceUID`, `SeriesInstanceUID`,
    `SOPClassUID`, and `SOPInstanceUID`, else the call throws an error that
    names each absent keyword.
-   **CORE-USR-10** When an inherited `Modality` differs from the base
    `Modality`, `createInstance` logs a warning and keeps the inherited value.
-   **CORE-USR-11** A caller can replace one base block, or add one, without
    a copy of the other blocks.
-   **CORE-USR-12** `instance` is a naturalized dataset, or an array of them.
    A DICOM JSON `instance` (tag keys with `{ vr, Value }`) throws an error.
    The error tells the caller to use `DicomMetaDictionary.naturalizeDataset`
    first. `nextSeriesNumberBase` accepts naturalized and DICOM JSON series,
    for example a QIDO-RS response. It reads `SeriesNumber` with the integer
    rule of CORE-USR-5. When the largest series number is 2147483647 (the IS
    maximum), the next `SeriesNumber` is 1.
-   **CORE-USR-13** A builder sets its payload attributes after
    `createInstance`. The builder README lists these attributes, and says
    what an override of each attribute does.
-   **CORE-USR-14** When `instance` is an array, the first item gives the
    inherited attributes. The predecessor rule (CORE-USR-9) and the
    `InstanceNumber` rule (CORE-USR-5) use all of the items.

### § Implementation requirements

-   **CORE-IMP-1** `createInstance` resolves `baseDicom` with a context. Then
    it copies the inherited attributes with
    `copyAttributesByLevel(instance, dataLevel, { levels })`, removes the
    identity keywords of CORE-USR-4, and applies the overrides.
-   **CORE-IMP-2** `baseDicom` is a base block: an object, a function
    `(context) => object`, an array of blocks, or `combineBases(...blocks)`.
    Later blocks win. A combined block keeps its parts on `.items`.
-   **CORE-IMP-3** The default bases are compositions, not extensions.
    `defaultInstanceBase` is `patientBase`, `studyBase`, `seriesBase`,
    `instanceBase`, and `equipmentBase`. The base of each builder adds its
    own blocks and `predecessorBase` to `defaultInstanceBase`.
-   **CORE-IMP-4** A function block gets a context with these keys:
    `dataLevel`, `levels`, `instance`, `predecessor`, `inherits(levelName)`,
    `date`, `time`, `dateTime`, and `options`. The level blocks create new
    identity only for the levels below `dataLevel`, through
    `context.inherits(levelName)`. Each producer of extra attributes is a
    base block:
    -   `instanceBase` sets `InstanceNumber` (CORE-USR-5).
    -   `predecessorBase` reads the `predecessor` flag.
    -   A factory such as `nextSeriesNumberBase(seriesList, filter)` or
        `derivedImageBase(derivedFrom, { lossy })` (`@dcmjs-org/imaging`)
        gets its data as an argument, and returns a block.
-   **CORE-IMP-5** The levels are a list of `{ name, tags }`. The caller
    gives the list as `levels`. `extendDataLevels` adds attributes to a level. A new level is a
    new entry. The level Sets use the Cornerstone3D adapter names. dcmjs also
    has `PatientAge`, `PatientSize`, and `PatientWeight` at study level.
-   **CORE-IMP-6** Inherited object values (sequences, PN objects, binary)
    are shared with `instance`. To clone them, give
    `instance: deepCloneInstance(source)`. Binary values stay shared unless
    the caller gives `{ copyBinary: true }`, because a copy of large binary
    data can use all of the memory. `deepCloneInstance(block)` wraps a function block,
    so each call returns a clone. A promise gives a promise for a clone. The
    builder freezes nothing, so a caller can change the result after the
    call.
-   **CORE-IMP-7** `_meta` is Explicit VR Little Endian from `instanceBase`. A
    writer that stores another transfer syntax must update it.
-   **CORE-IMP-8** `predecessorBase` and `hierarchicalReferences` use the
    same internal reference builder, so the sequence has the shape of
    `hierarchicalReferences`: one item for each study, then each series, then
    each SOP instance. Each function gives its own error text. `predecessorBase` is not in
    `defaultInstanceBase`.
-   **CORE-IMP-9** A builder removes its control keys before it calls
    `createInstance`, for example with destructuring.
-   **CORE-IMP-10** `createInstance` identifies a DICOM JSON `instance` by two
    conditions: every key is a tag of 8 hexadecimal digits, and at least one
    value is an object with a `vr` property. A naturalized dataset has
    keyword keys. The parser keeps a private element without a private
    creator as `{ vr, Value }` under its tag (`NaturalizedListener`), so one
    such key does not identify DICOM JSON.
