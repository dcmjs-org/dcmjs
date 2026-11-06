# frameDataset

## Overview

`frameDataset(dataset, frameNumber, options)` gives the view of one frame of
an enhanced multi-frame naturalized dataset. An enhanced multi-frame dataset
keeps per-frame data, for example the position of each frame, in functional
group sequences (PS3.3 C.7.6.16). The view reads the per-frame functional
groups of the frame first, then the shared functional groups, then the root.

The function is exported from `@dcmjs-org/core` and from `dcmjs.data` of
`@dcmjs-org/dcmjs`. It replaces a local `combineFrameInstance` merge in a
viewer.

[specs/naturalized-dataset.md](specs/naturalized-dataset.md) is the
specification: NAT-U-FRAME-1 to NAT-U-FRAME-9 are the user requirements,
NAT-I-FRAME-1 to NAT-I-FRAME-4 the implementation requirements. The tests
are in `test/core/frameDataset.test.js`.

## Usage

```js
import dcmjs from "@dcmjs-org/dcmjs";

const { frameDataset, DicomMetaDictionary } = dcmjs.data;
const dataset = DicomMetaDictionary.naturalizeDataset(dicomJson);

const frame2 = frameDataset(dataset, 2);
frame2.ImagePositionPatient; // from PerFrameFunctionalGroupsSequence[1].PlanePositionSequence
frame2.PixelSpacing; // from SharedFunctionalGroupsSequence.PixelMeasuresSequence
frame2.PatientID; // from the root
frameDataset(dataset, 2) === frame2; // true: the view is cached
```

`frameNumber` is 1-based, and a numeric string is accepted. A missing
`frameNumber` is 1. A frame number that is not an integer from 1 to
`NumberOfFrames` throws a `RangeError`. A frame number past the last
per-frame item is valid, so a caller can make a new per-frame item.

## When a view is built

`frameDataset` builds a view when `NumberOfFrames` is above 1. It also
builds a view when `NumberOfFrames` is 1 or more and the dataset has a
functional group sequence. The functional group sequences can be missing or
empty, so a caller can use the view for a multi-frame image that is not
enhanced, for example to compute default values for each frame with
`options.frameAttributes`. Any other dataset comes back unchanged (the same
object), the option functions do not run, and the frame number is not
checked.

## What the view reads

- Per-frame functional groups first, then shared, then the root. A later
  level replaces an attribute of an earlier level.
- Each standard sequence (functional group macro) in a functional group item
  gives the attributes of its first item.
- A macro item that holds a `SOPInstanceUID` is reference or previous value
  data, and is skipped.
- A private block or a private hex-tag key directly in a functional group
  item is skipped. With `options.privateMacros`, each private sequence there
  (an `SQ` in `_vrMap`) is a macro too. A private block inside a standard
  macro item is a frame attribute: it replaces a root block with the same
  key, and its hex aliases read the frame's block.
- The view keeps the naturalized form: a one-item sequence keeps `[0]`,
  `length` and the iterator, and the private aliases work.

The view is an `Object.create` child of `dataset`. The functional group
attributes are its own keys, with their VRs in an own `_vrMap`, so
`DicomMetaDictionary.denaturalizeDataset(view)` writes only the functional
group attributes of the frame and the computed attributes. Root attributes
are inherited, so a later change to a root attribute shows in each view.

## Options

`options.frameAttributes(view, { dataset, frameNumber })` returns an object
of computed attributes. The view gets them as own enumerable keys, they
replace the merged values, and `denaturalizeDataset` writes them. Use this
for values a modality keeps in another place, for example the NM position
from `DetectorInformationSequence`, the RTDOSE position from
`GridFrameOffsetVector`, or a `[0, 0, frameNumber]` default.

`options.frameProperties(view, { dataset, frameNumber })` returns an object
of runtime properties. The view gets them as own non-enumerable properties,
so JSON and `denaturalizeDataset` skip them. Use this for viewer values like
`frameNumber`, `imageId` or `url`.

```js
const options = {
    frameAttributes: (view, { frameNumber }) =>
        view.ImagePositionPatient ? {} : { ImagePositionPatient: [0, 0, frameNumber] },
    frameProperties: (view, { frameNumber }) => ({ frameNumber })
};
frameDataset(dataset, 3, options).frameNumber; // 3, non-enumerable
```

`options.privateMacros` (default `false`): when `true`, the view also reads
the first item of each private sequence in a functional group item.

## The cache

The views are cached on `dataset` in the non-enumerable `_frameDatasets`
key, per set of options. A second call with the same arguments gives the
same object and does no work. `Object.keys`, JSON and `denaturalizeDataset`
do not see the cache key.

The cache is keyed by the identity of the option functions. **Define the
option functions once, at module level** — a caller that builds
`frameAttributes` or `frameProperties` inline on each call never hits the
cache and rebuilds the view on every lookup. Pass per-call data through the
view and the `{ dataset, frameNumber }` context instead of capturing it in a
new closure.

A change to a functional group item does not show in a cached view. Delete
the cache to rebuild the views after such a change:

```js
delete dataset._frameDatasets;
```

## Migration from combineFrameInstance

OHIF and Cornerstone3D each kept a copy of this merge with the name
`combineFrameInstance`. [MIGRATION.md](MIGRATION.md) names the differences;
the one behaviour change is the merge order of `ImagePositionPatient`: the
per-frame value comes first (PS3.3 C.7.6.16), and a root value is only a
fallback. The modality fallbacks (NM, RTDOSE, defaults) and the viewer
runtime properties stay in the caller, through the option functions.
