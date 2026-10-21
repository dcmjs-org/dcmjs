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
    overrides: { SeriesDescription: "Annotations" }
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

-   **CORE-USR-1** Every builder takes the same options. The options object
    holds three kinds of keys:

    1. The `createInstance` controls: `baseDicom`, `instance`, `dataLevel`,
       `levels`, `predecessor`, and `postProcess`. These keys are options.
    2. The control keys of the builder, for example `mimeType`,
       `derivedFrom`, `lossy`, `encapsulated`, or `fragmentBytes`. The
       builder README lists them. These keys are also options.
    3. `overrides`, a naturalized DICOM provider. `overrides` has the same
       forms as `baseDicom`: a naturalized object, a function that gets the
       context and returns a naturalized object, an array of these (a later
       entry wins), or a block from `combineBases`. The attributes of
       `overrides` go into the result with the highest precedence
       (CORE-USR-6). Each attribute that `overrides` gives is an override.

    `overrides` holds only DICOM attributes. A control key never goes in
    `overrides`, and `overrides` has no effect on a control key.

    `baseDicom` and `overrides` accept a provider at each depth: the option,
    each array entry, and each function result. A provider is synchronous.
    An `overrides` that is `undefined` or `null` gives no overrides. A
    `baseDicom` of `null` gives no base attributes, and a `baseDicom` of
    `undefined` gives the default base.

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
        specific `SOPInstanceUID`, goes in `overrides`.
    -   When an inherited study has no `StudyDate` or `StudyTime`, the value
        is `""` (Type 2 empty). When an inherited series has no
        `SeriesNumber`, the value is `""`.
    -   A `dataLevel` that is not a level name of `levels` throws an error.
        The error lists the level names.
-   **CORE-USR-4** The identity of `instance` is `SOPInstanceUID`,
    `SOPClassUID`, `InstanceNumber`, `MediaStorageSOPInstanceUID`, and
    `MediaStorageSOPClassUID`. The default levels (`DATA_LEVELS`) do not
    hold these keywords, so the result does not get the identity of
    `instance`. A custom `levels` copies each keyword that it lists, also an
    identity keyword. That copy is the choice of the caller. The base
    blocks set the identity: a new `SOPInstanceUID`, the `SOPClassUID` of
    the builder, and the `InstanceNumber` of CORE-USR-5. A copied value and
    an override replace a base value, in the order of CORE-USR-6. With
    `predecessor: true` and a base that includes `predecessorBase`, the
    identity of `instance` goes into `PredecessorDocumentsSequence`
    (CORE-USR-9).
-   **CORE-USR-5** With `dataLevel: "series"` (or a deeper custom level),
    `instance` is the sample instance in the series. The new
    `InstanceNumber` is the `InstanceNumber` of the sample instance, plus 1.
    -   When `instance` is an array, the first item is the sample instance.
        The other items have no effect on `InstanceNumber`.
    -   A number, an IS string, and a one-element array are integers. A
        sample value that is not an integer, that is less than 0, or that is
        2147483647 (the IS maximum) or more is not a usable value.
    -   The `InstanceNumber` is 1 when the sample instance has no usable
        value, or when `dataLevel` does not inherit the series.
    -   An `InstanceNumber` override replaces this value (CORE-USR-6).
-   **CORE-USR-6** The precedence is base blocks < inherited < `overrides`.
    An override always wins, except for the payload attributes that a
    builder sets after `createInstance` (see CORE-USR-13). For example,
    `overrides: { SOPInstanceUID: "1.2.3" }` sets the `SOPInstanceUID` of the
    result. An `_meta` override that is an object merges into the base
    `_meta` key by key. A key of the `_meta` override wins, and the other
    keys of the base `_meta` stay. For example, an `_meta` override with
    only `ImplementationVersionName` keeps the `TransferSyntaxUID` of the
    base. Give each `_meta` value in the shape `{ Value: [value] }`, for
    example `_meta.TransferSyntaxUID = { Value: ["1.2.840.10008.1.2.1"] }`.
-   **CORE-USR-7** The JSDoc of each function states the input types. An
    extra option key has no effect. Each key of the resolved `overrides`
    goes into the merge, also a key with an `undefined` value (CORE-USR-8).
    A user requirement names each error that a function throws for a wrong
    input value: CORE-USR-3 and CORE-USR-9 here, and the checks in the
    README of each builder. CORE-IMP-11 gives the rule for these checks.
-   **CORE-USR-8** An `undefined` value in the resolved `overrides` replaces
    the base or inherited value. With the default `postProcess`
    (CORE-USR-15), the result then does not have the attribute. Thus an
    `undefined` override removes the attribute. With the default
    `postProcess`, an `undefined` value from a base block or from `instance`
    also gives no attribute. A `null` or `""`
    value in the resolved `overrides` gives a Type 2 empty value. The
    builders do not invent a value: an attribute without a source is empty
    or absent.
-   **CORE-USR-9** `predecessorBase` is an optional base block. It is one
    more way to add default attributes. With `predecessor: true`, the block
    lists each `instance` in `PredecessorDocumentsSequence (0040,A360)`.
    -   `predecessor: true` has an effect only when the base includes
        `predecessorBase`. Without the block, `predecessor: true` adds no
        attribute and throws no error.
    -   The default bases of the encapsulated documents include the block:
        `encapsulatedBase` and `encapsulatedPdfBase`. The other default
        bases, for example `imageBase` and `videoBase`, do not include it.
    -   A caller can add the block to another base, for example
        `combineBases(imageBase, predecessorBase)`. A future document type
        can also add it to its default base.
    -   The new object replaces the older ones, and the older objects do not
        change. Use `dataLevel: "series"` to put the new version in the
        series of the old one.
    -   When the base includes the block, each `instance` must have
        `StudyInstanceUID`, `SeriesInstanceUID`, `SOPClassUID`, and
        `SOPInstanceUID`. Else the call throws an error that names each
        absent keyword. `hierarchicalReferences` throws the same error for an
        instance without one of these keywords.
-   **CORE-USR-10** When an inherited `Modality` differs from the base
    `Modality`, and `overrides` does not give `Modality`, `createInstance`
    logs a warning and keeps the inherited value. An override of `Modality`
    with each value, also `undefined`, `null`, or `""`, decides the result,
    so `createInstance` does not log the warning.
-   **CORE-USR-11** A caller can replace one base block, or add one, without
    a copy of the other blocks.
-   **CORE-USR-12** `instance` is a naturalized dataset, or an array of them.
    Use `DicomMetaDictionary.naturalizeDataset` on a DICOM JSON instance
    first. An `instance` that is not naturalized, for example DICOM JSON,
    gives no inherited attributes, and the inherited levels get no new UID:
    the result has no `StudyInstanceUID` (and, with `dataLevel: "series"`,
    no `SeriesInstanceUID`), and no error occurs. `nextSeriesNumberBase` accepts naturalized and DICOM JSON series,
    for example a QIDO-RS response. It reads `SeriesNumber` with the integer
    rule of CORE-USR-5. When the largest series number is 2147483647 (the IS
    maximum), the next `SeriesNumber` is 1.
-   **CORE-USR-13** A builder sets its payload attributes after
    `createInstance`. The builder README lists these attributes, and says
    what an override of each attribute does. The same `_meta` rule applies
    to each builder:
    -   The `_meta` of the result is a new object. A change to the result
        `_meta` does not change the `_meta` of `overrides` or of a base
        block.
    -   A builder changes only `_meta.TransferSyntaxUID`. It keeps each
        other key of the merged `_meta` (CORE-USR-6).
    -   A builder sets `_meta.TransferSyntaxUID` in the shape
        `{ Value: [uid] }`. The builder README says when the builder sets
        it.
-   **CORE-USR-14** When `instance` is an array, the first item gives the
    inherited attributes and the sample `InstanceNumber` (CORE-USR-5). The
    predecessor rule (CORE-USR-9) uses all of the items: each item goes in
    `PredecessorDocumentsSequence`.
-   **CORE-USR-15** `postProcess` is a function
    `(dataset, context) => dataset`. `createInstance` calls `postProcess`
    once, on the merged result, with the context of CORE-IMP-4.
    `createInstance` returns the return value of `postProcess`.
    -   The default `postProcess` is `removeUndefinedAttributes`. This
        function deletes each top-level attribute with an `undefined` value.
        It does not change the items of a sequence.
    -   A custom `postProcess` replaces the default. To keep the default
        step, call `removeUndefinedAttributes` in the custom function.
    -   A builder calls `postProcess` only through `createInstance`. Thus
        `postProcess` does not see the payload attributes of CORE-USR-13,
        and the builder does not call `postProcess` again.

### § Implementation requirements

-   **CORE-IMP-1** `createInstance` works in this order:

    1. It makes the context.
    2. It resolves `baseDicom` with `resolveBase(baseDicom, context)`.
    3. It resolves `options.overrides` once with
       `resolveBase(options.overrides, context)`. It keeps the `undefined`
       values (CORE-USR-8).
    4. It copies the inherited attributes with
       `copyAttributesByLevel(instance, dataLevel, { levels })`. It removes
       no keyword from the copy (CORE-USR-4).
    5. It spreads the base, the inherited attributes, and the resolved
       overrides, in this order, into the result. When the `_meta` override
       is an object, the result `_meta` is a new object: the base `_meta`,
       then the inherited `_meta`, then the `_meta` override (CORE-USR-6).
    6. It calls `postProcess(result, context)`, and returns the return
       value (CORE-USR-15).

    The Modality warning (CORE-USR-10) reads the resolved overrides. It
    tests the presence of the `Modality` key (`Object.hasOwn`), and not the
    value.

-   **CORE-IMP-2** `baseDicom` and `overrides` are naturalized DICOM
    providers. A provider is an object, a function `(context) => object`, an
    array of providers, or `combineBases(...blocks)`. Later entries win. A
    combined block keeps its parts on `.items`. `resolveBase` resolves both
    options, and gives `{}` for `undefined` and `null`. It resolves an array
    entry by entry, and a function through its result. It copies each other
    value into a new object, and does not check the type of the value
    (CORE-IMP-11).
-   **CORE-IMP-3** The default bases are compositions, not extensions.
    `defaultInstanceBase` is `patientBase`, `studyBase`, `seriesBase`,
    `instanceBase`, and `equipmentBase`. The base of each builder adds its
    own blocks to `defaultInstanceBase`. Only the encapsulated document
    bases also add `predecessorBase` (CORE-USR-9).
-   **CORE-IMP-4** A function block gets a context with these keys:
    `dataLevel`, `levels`, `instance`, `predecessor`, `inherits(levelName)`,
    `date`, `time`, `dateTime`, and `options`. `context.options` is the
    options object that `createInstance` gets. Through a builder,
    `context.options` is the options object that the builder forwards,
    without the builder control keys. A function in `overrides` and
    `postProcess` get the same context. The level blocks create new
    identity only for the levels below `dataLevel`, through
    `context.inherits(levelName)`. Each producer of extra attributes is a
    base block:
    -   `instanceBase` sets `InstanceNumber` (CORE-USR-5).
    -   `predecessorBase` reads the `predecessor` flag.
    -   A factory such as `nextSeriesNumberBase(seriesList, filter)` or
        `derivedImageBase(derivedFrom, { lossy })` (`@dcmjs-org/imaging`)
        gets its data as an argument, and returns a block.
-   **CORE-IMP-5** The levels are a list of `{ name, tags }`. The caller
    gives the list as `levels`. `extendDataLevels` adds attributes to a
    level. A new level is a new entry. The level Sets use the Cornerstone3D
    adapter names. dcmjs also has `PatientAge`, `PatientSize`, and
    `PatientWeight` at study level.
-   **CORE-IMP-6** Inherited object values (sequences, PN objects, binary)
    are shared with `instance`. To clone them, give
    `instance: deepCloneInstance(source)`. Binary values stay shared unless
    the caller gives `{ copyBinary: true }`, because a copy of large binary
    data can use all of the memory. `deepCloneInstance(block)` wraps a
    function block, so each call returns a clone. A promise gives a promise
    for a clone. The builder freezes nothing, so a caller can change the
    result after the call.
-   **CORE-IMP-7** `_meta` is Explicit VR Little Endian from `instanceBase`. A
    writer that stores another transfer syntax must update it. A builder
    makes the new `_meta` of CORE-USR-13 with a spread copy, for example
    `{ ...dataset._meta, TransferSyntaxUID: { Value: [uid] } }`. A builder
    that needs a file meta group for its own output (for example
    `createVideoEventSource`) makes the group in a local object, and does
    not assign the group to the `_meta` of the dataset that it returns.
-   **CORE-IMP-8** `predecessorBase` and `hierarchicalReferences` use the
    same internal reference builder, so the sequence has the shape of
    `hierarchicalReferences`: one item for each study, then each series, then
    each SOP instance. Each function gives its own error text.
    `predecessorBase` is not in `defaultInstanceBase`. The `predecessor`
    control has no other reader: only `predecessorBase` reads
    `context.predecessor`.
-   **CORE-IMP-9** A builder removes its control keys before it calls
    `createInstance`, for example with destructuring
    (`const { mimeType, ...rest } = options`). The builder passes `overrides`
    and `postProcess` to `createInstance` without a change. A builder that
    sets a payload attribute after `createInstance` replaces an override of
    that attribute, from each form of `overrides`. `createInstance` reads only
    its own control keys, so another key has no effect (CORE-USR-7).
-   **CORE-IMP-10** Removed. This requirement described the detection of a
    DICOM JSON `instance`. `createInstance` does not check the type of
    `instance` (CORE-IMP-11, CORE-USR-12).
-   **CORE-IMP-11** Validation is part of the usage flow. A function checks
    a value where it uses the value, when a wrong value gives a wrong
    result. Examples:

    -   Data that a caller gives as a PDF, but that is not a PDF.
    -   An unknown `dataLevel` name, which the level lookup uses.
    -   An `extract*` call on a dataset of the wrong type.
    -   Pixel data whose length does not match the geometry.

    A function does not check a value only to check it. For example, it
    does not check the JS type of an input that the JSDoc declares, such as
    a byte array or an object. The JSDoc gives the type. A type check also
    blocks a future input form, for example a stream, an async result, or
    another source. An input of a wrong type fails where the code uses it,
    or gives no error. Each check of this rule has a user requirement
    (CORE-USR-7).
