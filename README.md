<div align="center">
  <h1>dcmjs</h1>
  <p>JavaScript implementation of DICOM manipulation. This code is an outgrowth of several efforts to implement web applications for medical imaging.</p>
</div>

<hr />

[![CI](https://github.com/dcmjs-org/dcmjs/actions/workflows/publish-package.yml/badge.svg)](https://github.com/dcmjs-org/dcmjs/actions?query=workflow:publish-package)

**Note: this code is a work-in-progress**

This is a community effort so please help improve support for a wide range of DICOM data and use cases.

See [live examples here](https://master--dcmjs2.netlify.app/)

# Goals

_Overall the code should:_

- Support reading and writing of correct DICOM objects in JavaScript for browser or node environments
- Provide a programmer-friendly JavaScript environment for using and manipulating DICOM objects
- Include a set of useful demos to encourage correct usage of dcmjs and modern DICOM objects
- Encourage correct referencing of instances and composite context when creating derived objects
- Current target is modern web browsers, but a set of node-based utilities also makes sense someday

_Architectural goals include:_

- Use modern JavaScript programming methods (currently ES6) but avoid heavy frameworks
- Leverage modern DICOM standards but avoid legacy parts
- Support straightforward integration with multiple JavaScript deployment targets (browser, node, etc) and frameworks.

_Parts of DICOM that dcmjs *will* focus on:_

- Enhanced Multiframe Images
- Segmentation Objects
- Parametric Maps
- Structured Reports

_Parts of DICOM that dcmjs *will not* focus on:_

- DIMSE (legacy networking like C-STORE, C-FIND, C-MOVE, etc). See the [dcmjs-dimse](https://github.com/PantelisGeorgiadis/dcmjs-dimse) project for that.
- Physical Media (optical disks). See [this FAQ](https://www.dclunie.com/medical-image-faq/html/index.html) if you need to work with those.
- Image rendering. See [dcmjs-imaging](https://github.com/PantelisGeorgiadis/dcmjs-imaging) for this.
- Encapsulated transfer syntax transcoding. See [dcmjs-codecs](https://github.com/PantelisGeorgiadis/dcmjs-codecs) for this.
- 3D rendering.  See [vtk.js](https://kitware.github.io/vtk-js/index.html).
- Radiology review application - see [OHIF](https://ohif.org).
- Deidentification and data organization - see [dcm-organize](https://github.com/bebbi/dcm-organize) for this.

# Usage

## In Browser

```html
<script type="text/javascript" src="https://unpkg.com/dcmjs"></script>
```

## In Node

```None
// To install latest _stable_ release
npm install --save dcmjs

// To install latest code merged to master
npm install --save dcmjs@dev
```

## For Developers

```None
git clone https://github.com/dcmjs-org/dcmjs
cd dcmjs
npm install
npm run build
npm test
```

## For Maintainers and Contributors

Publish new version automatically from commit:

Use the following "Commit Message Format" when drafting commit messages. If you're merging a 3rd party's PR, you have the ability to override the supplied commit messages by doing a "Squash & Merge":

- [Commit Message Format](https://semantic-release.gitbook.io/semantic-release/#commit-message-format)

Note: Be wary of `BREAKING_CHANGE` in commit message descriptions, as this can force a major version bump.

Be sure to use lower case for the first letter of your semantic commit message, so use `fix` not `Fix` or `feat` not `Feat`, have a space after the : and make the PR github review title follow the SAME rules.  It is the PR review title that determins the final commit message and will be used for semantic detection.

Note: a new package version will be published only if the commit comes from a PR.

### Optional Tooling

It is advised to use the git-cz, i.e.:

- install git-cz

```
npm install -g git-cz
```

- how to commit

```
git-cz --non-interactive --type=fix --subject="commit message"
```

More info at [git-cz](https://www.npmjs.com/package/git-cz).

## Community Participation

Use this repository's issues page to report any bugs. Please follow [SSCCE](http://sscce.org/) guidelines when submitting issues.

Use github pull requests to make contributions.

## Unit Tests

Tests are written using the [Jest](https://jestjs.io) testing framework and live in the `test/` folder. Test file names must end with `.test.js`.

Pull requests should either update existing tests or add new tests in order to ensure good test coverage of the changes being made.

To run all tests use `npm run test`. To only run specific tests use Jest's [`.only`](https://www.testim.io/blog/unit-testing-best-practices/) feature. If you're using VS Code, an extension such as [`firsttris.vscode-jest-runner`](https://marketplace.visualstudio.com/items?itemName=firsttris.vscode-jest-runner) can be used to step through specific tests in the debugger.

Read all about unit testing best practices [here](https://www.testim.io/blog/unit-testing-best-practices/).

# Status

Currently dcmjs is an early-stage development experiment, but already has valuable functionality.

## Implemented

- Bidirectional conversion to and from part 10 binary DICOM and DICOM standard JSON encoding (as in [DICOMweb](http://dicomweb.org))
- Bidirectional convertion to and from DICOM standard JSON and a programmer-friendly high-level version (high-level form is called the "naturalized" form in the code).

## In development

- Creation of (correct) enhanced multiframe DICOM objects from legacy image objects
- Creation of (correct) derived DICOM objects such as Segmentations and Structured Reports

## TODO

- Create a test suite of input and output DICOM objects
- Test interoperability with other DICOM implementations
- Add documentation

# History

- 2014
  - [DCMTK](dcmtk.org) cross compiled to javascript at [CTK Hackfest](http://www.commontk.org/index.php/CTK-Hackfest-May-2014). While this was useful and powerful, it was heavyweight for typical web usage.
- 2016
  - A [Medical Imaging Web Appliction meeting at Stanford](http://qiicr.org/web/outreach/Medical-Imaging-Web-Apps/) and [follow-on hackfest in Boston](http://qiicr.org/web/outreach/MIWS-hackfest/) helped elaborate the needs for manipulating DICOM in pure Javascript.
  - Based on [DICOM Part 10 read/write code](https://github.com/OHIF/dicom-dimse) initiated by Weiwei Wu of [OHIF](http://ohif.org), Steve Pieper [developed further features](https://github.com/pieper/sites/tree/gh-pages/dcmio) and [examples of creating multiframe and segmentation objects](https://github.com/pieper/sites/tree/gh-pages/DICOMzero) discussed with the community at RSNA
- 2017
  - At [NA-MIC Project Week 25](https://na-mic.org/wiki/Project_Week_25) Erik Ziegler and Steve Pieper [worked](https://na-mic.org/wiki/Project_Week_25/DICOM_Segmentation_Support_for_Cornerstone_and_OHIF_Viewer)
    with the community to define some example use cases to mix the pure JavaScript DICOM code with Cornerstone and [CornerstoneTools](https://github.com/chafey/cornerstoneTools).
- 2018-2022
  - Work continues to develop SR and SEG support to [OHIFViewer](http://ohif.org) allow interoperability with [DICOM4QI](https://legacy.gitbook.com/book/qiicr/dicom4qi/details)
- 2022-present
  - dcmjs is used by a number of projects and as of January 2025 has about 15,000 weekly [downloads from npm]([url](https://www.npmjs.com/package/dcmjs)).

# Support

The developers gratefully acknowledge their research support:

- Open Health Imaging Foundation ([OHIF](http://ohif.org))
- Quantitative Image Informatics for Cancer Research ([QIICR](http://qiicr.org))
- [Radiomics](http://radiomics.io)
- The [Neuroimage Analysis Center](http://nac.spl.harvard.edu)
- The [National Center for Image Guided Therapy](http://ncigt.org)
- The [NCI Imaging Data Commons](https://imagingdatacommons.github.io/) NCI Imaging Data Commons: contract number 19X037Q from Leidos Biomedical Research under Task Order HHSN26100071 from NCI

## Logging

This library uses [loglevel](https://github.com/pimterry/loglevel) for logging. By default, the log level is set to "warn". You can change the log level by setting the `LOG_LEVEL` environment variable or by using the `setLevel` method in your code.
