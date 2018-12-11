webpackHotUpdatedcmjs("dcmjs",{

/***/ "./derivations.js":
/*!************************!*\
  !*** ./derivations.js ***!
  \************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.StructuredReport = exports.Segmentation = exports.DerivedImage = exports.DerivedPixels = exports.DerivedDataset = undefined;

var _get = function get(object, property, receiver) { if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { return get(parent, property, receiver); } } else if ("value" in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _DicomMetaDictionary = __webpack_require__(/*! ./DicomMetaDictionary.js */ "./DicomMetaDictionary.js");

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var DerivedDataset = function () {
  function DerivedDataset(datasets) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    _classCallCheck(this, DerivedDataset);

    this.options = JSON.parse(JSON.stringify(options));
    var o = this.options;

    o.Manufacturer = options.Manufacturer || "Unspecified";
    o.ManufacturerModelName = options.ManufacturerModelName || "Unspecified";
    o.SeriesDescription = options.SeriesDescription || "Research Derived series";
    o.SeriesNumber = options.SeriesNumber || "99";
    o.SoftwareVersions = options.SoftwareVersions || "0";
    o.DeviceSerialNumber = options.DeviceSerialNumber || "1";

    var date = _DicomMetaDictionary.DicomMetaDictionary.date();
    var time = _DicomMetaDictionary.DicomMetaDictionary.time();

    o.SeriesDate = options.SeriesDate || date;
    o.SeriesTime = options.SeriesTime || time;
    o.ContentDate = options.ContentDate || date;
    o.ContentTime = options.ContentTime || time;

    o.SOPInstanceUID = options.SOPInstanceUID || _DicomMetaDictionary.DicomMetaDictionary.uid();
    o.SeriesInstanceUID = options.SeriesInstanceUID || _DicomMetaDictionary.DicomMetaDictionary.uid();

    o.ClinicalTrialTimePointID = options.ClinicalTrialTimePointID || "";
    o.ClinicalTrialCoordinatingCenterName = options.ClinicalTrialCoordinatingCenterName || "";
    o.ClinicalTrialSeriesID = options.ClinicalTrialSeriesID || "";

    o.ImageComments = options.ImageComments || "NOT FOR CLINICAL USE";
    o.ContentQualification = "RESEARCH";

    this.referencedDatasets = datasets; // list of one or more dicom-like object instances
    this.referencedDataset = this.referencedDatasets[0];
    this.dataset = {
      _vrMap: this.referencedDataset._vrMap,
      _meta: this.referencedDataset._meta
    };

    this.derive();
  }

  _createClass(DerivedDataset, [{
    key: "assignToDataset",
    value: function assignToDataset(data) {
      var _this = this;

      Object.keys(data).forEach(function (key) {
        return _this.dataset[key] = data[key];
      });
    }
  }, {
    key: "assignFromReference",
    value: function assignFromReference(tags) {
      var _this2 = this;

      tags.forEach(function (tag) {
        return _this2.dataset[tag] = _this2.referencedDataset[tag] || "";
      });
    }
  }, {
    key: "assignFromOptions",
    value: function assignFromOptions(tags) {
      var _this3 = this;

      tags.forEach(function (tag) {
        return _this3.dataset[tag] = _this3.options[tag] || "";
      });
    }
  }, {
    key: "derive",
    value: function derive() {
      // common for all instances in study
      this.assignFromReference(["AccessionNumber", "ReferringPhysicianName", "StudyDate", "StudyID", "StudyTime", "PatientName", "PatientID", "PatientBirthDate", "PatientSex", "PatientAge", "StudyInstanceUID", "StudyID"]);

      this.assignFromOptions(["Manufacturer", "SoftwareVersions", "DeviceSerialNumber", "ManufacturerModelName", "SeriesDescription", "SeriesNumber", "ImageComments", "SeriesDate", "SeriesTime", "ContentDate", "ContentTime", "ContentQualification", "SOPInstanceUID", "SeriesInstanceUID"]);
    }
  }], [{
    key: "copyDataset",
    value: function copyDataset(dataset) {
      // copies everything but the buffers
      return JSON.parse(JSON.stringify(dataset));
    }
  }]);

  return DerivedDataset;
}();

var DerivedPixels = function (_DerivedDataset) {
  _inherits(DerivedPixels, _DerivedDataset);

  function DerivedPixels(datasets) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    _classCallCheck(this, DerivedPixels);

    var _this4 = _possibleConstructorReturn(this, (DerivedPixels.__proto__ || Object.getPrototypeOf(DerivedPixels)).call(this, datasets, options));

    var o = _this4.options;

    o.ContentLabel = options.ContentLabel || "";
    o.ContentDescription = options.ContentDescription || "";
    o.ContentCreatorName = options.ContentCreatorName || "";

    return _this4;
  }

  // this assumes a normalized multiframe input and will create
  // a multiframe derived image


  _createClass(DerivedPixels, [{
    key: "derive",
    value: function derive() {
      _get(DerivedPixels.prototype.__proto__ || Object.getPrototypeOf(DerivedPixels.prototype), "derive", this).call(this);

      this.assignToDataset({
        "ImageType": ["DERIVED", "PRIMARY"],
        "LossyImageCompression": "00",
        "InstanceNumber": "1"
      });

      this.assignFromReference(["SOPClassUID", "Modality", "FrameOfReferenceUID", "PositionReferenceIndicator", "NumberOfFrames", "Rows", "Columns", "SamplesPerPixel", "PhotometricInterpretation", "BitsStored", "HighBit"]);

      this.assignFromOptions(["ContentLabel", "ContentDescription", "ContentCreatorName"]);

      //
      // TODO: more carefully copy only PixelMeasures and related
      // TODO: add derivation references
      //
      if (this.referencedDataset.SharedFunctionalGroupsSequence) {
        this.dataset.SharedFunctionalGroupsSequence = DerivedDataset.copyDataset(this.referencedDataset.SharedFunctionalGroupsSequence);
      }
      if (this.referencedDataset.PerFrameFunctionalGroupsSequence) {
        this.dataset.PerFrameFunctionalGroupsSequence = DerivedDataset.copyDataset(this.referencedDataset.PerFrameFunctionalGroupsSequence);
      }

      // make an array of zeros for the pixels
      this.dataset.PixelData = new ArrayBuffer(this.referencedDataset.PixelData.byteLength);
    }
  }]);

  return DerivedPixels;
}(DerivedDataset);

var DerivedImage = function (_DerivedPixels) {
  _inherits(DerivedImage, _DerivedPixels);

  function DerivedImage(datasets) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    _classCallCheck(this, DerivedImage);

    return _possibleConstructorReturn(this, (DerivedImage.__proto__ || Object.getPrototypeOf(DerivedImage)).call(this, datasets, options));
  }

  _createClass(DerivedImage, [{
    key: "derive",
    value: function derive() {
      _get(DerivedImage.prototype.__proto__ || Object.getPrototypeOf(DerivedImage.prototype), "derive", this).call(this);
      this.assignFromReference(["WindowCenter", "WindowWidth", "BitsAllocated", "PixelRepresentation", "BodyPartExamined", "Laterality", "PatientPosition", "RescaleSlope", "RescaleIntercept", "PixelPresentation", "VolumetricProperties", "VolumeBasedCalculationTechnique", "PresentationLUTShape"]);
    }
  }]);

  return DerivedImage;
}(DerivedPixels);

var Segmentation = function (_DerivedPixels2) {
  _inherits(Segmentation, _DerivedPixels2);

  function Segmentation(datasets) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : { includeSliceSpacing: true };

    _classCallCheck(this, Segmentation);

    return _possibleConstructorReturn(this, (Segmentation.__proto__ || Object.getPrototypeOf(Segmentation)).call(this, datasets, options));
  }

  _createClass(Segmentation, [{
    key: "derive",
    value: function derive() {
      _get(Segmentation.prototype.__proto__ || Object.getPrototypeOf(Segmentation.prototype), "derive", this).call(this);

      this.assignToDataset({
        "SOPClassUID": _DicomMetaDictionary.DicomMetaDictionary.sopClassUIDsByName.Segmentation,
        "Modality": "SEG",
        "SamplesPerPixel": "1",
        "PhotometricInterpretation": "MONOCHROME2",
        "BitsAllocated": "1",
        "BitsStored": "1",
        "HighBit": "0",
        "PixelRepresentation": "0",
        "LossyImageCompression": "00",
        "SegmentationType": "BINARY",
        "ContentLabel": "EXAMPLE"
      });

      var dimensionUID = _DicomMetaDictionary.DicomMetaDictionary.uid();
      this.dataset.DimensionOrganizationSequence = {
        DimensionOrganizationUID: dimensionUID
      };
      this.dataset.DimensionIndexSequence = [{
        DimensionOrganizationUID: dimensionUID,
        DimensionIndexPointer: 6422539,
        FunctionalGroupPointer: 6422538, // SegmentIdentificationSequence
        DimensionDescriptionLabel: "ReferencedSegmentNumber"
      }, {
        DimensionOrganizationUID: dimensionUID,
        DimensionIndexPointer: 2097202,
        FunctionalGroupPointer: 2134291, // PlanePositionSequence
        DimensionDescriptionLabel: "ImagePositionPatient"
      }];

      this.dataset.SegmentSequence = [];

      // TODO: check logic here.
      // If the referenced dataset itself references a series, then copy.
      // Otherwise, reference the dataset itself.
      // This should allow Slicer and others to get the correct original
      // images when loading Legacy Converted Images, but it's a workaround
      // that really doesn't belong here.
      if (this.referencedDataset.ReferencedSeriesSequence) {
        this.dataset.ReferencedSeriesSequence = DerivedDataset.copyDataset(this.referencedDataset.ReferencedSeriesSequence);
      } else {
        // TODO -> Build up a sequence based on this.referencedDatasets.
        var ReferencedInstanceSequence = [];
        for (var i = 0; i < this.referencedDatasets.length; i++) {}

        this.dataset.ReferencedSeriesSequence = {
          SeriesInstanceUID: this.referencedDataset.SeriesInstanceUID,
          StudyInstanceUID: this.referencedDataset.StudyInstanceUID,
          ReferencedInstanceSequence: [{
            ReferencedSOPClassUID: this.referencedDataset.SOPClassUID,
            ReferencedSOPInstanceUID: this.referencedDataset.SOPInstanceUID
          }]
        };
      }

      // handle the case of a converted multiframe, so point to original source
      // TODO: only a single segment is created now
      for (var frameIndex = 0; frameIndex < this.dataset.NumberOfFrames; frameIndex++) {
        this.dataset.PerFrameFunctionalGroupsSequence[frameIndex].DerivationImageSequence = {
          SourceImageSequence: {
            ReferencedSOPClassUID: this.referencedDataset.SOPClassUID,
            ReferencedSOPInstanceUID: this.referencedDataset.SOPInstanceUID,
            ReferencedFrameNumber: frameIndex + 1,
            PurposeOfReferenceCodeSequence: {
              CodeValue: "121322",
              CodingSchemeDesignator: "DCM",
              CodeMeaning: "Source image for image processing operation"
            }
          },
          DerivationCodeSequence: {
            CodeValue: "113076",
            CodingSchemeDesignator: "DCM",
            CodeMeaning: "Segmentation"
          }
        };
        this.dataset.PerFrameFunctionalGroupsSequence[frameIndex].FrameContentSequence = {
          DimensionIndexValues: [1, frameIndex + 1]
        };
        this.dataset.PerFrameFunctionalGroupsSequence[frameIndex].SegmentIdentificationSequence = {
          ReferencedSegmentNumber: 1
        };
      }

      // these are copied with pixels, but don't belong in segmentation
      for (var _frameIndex = 0; _frameIndex < this.dataset.NumberOfFrames; _frameIndex++) {
        // TODO: instead explicitly copy the position sequence
        var group = this.dataset.PerFrameFunctionalGroupsSequence[_frameIndex];
        delete group.FrameVOILUTSequence;
      }

      if (!this.options.includeSliceSpacing) {
        // per dciodvfy this should not be included, but dcmqi/Slicer requires it
        delete this.dataset.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SpacingBetweenSlices;
      }

      // make an array of zeros for the pixels assuming bit packing (one bit per short)
      // TODO: handle different packing and non-multiple of 8/16 rows and columns
      this.dataset.PixelData = new ArrayBuffer(this.referencedDataset.PixelData.byteLength / 16);
    }
  }, {
    key: "addSegment",
    value: function addSegment(Segment) {
      if (!Segment.SegmentLabel || !Segment.SegmentedPropertyCategoryCodeSequence || !Segment.SegmentedPropertyTypeCodeSequence || !Segment.SegmentAlgorithmType) {
        throw new Error("Segment does not contain all the required fields.");
      }

      // Capitalise the SegmentAlgorithmType if it happens to be given in
      // Lower/mixed case.
      Segment.SegmentAlgorithmType = Segment.SegmentAlgorithmType.toUpperCase();

      // Check SegmentAlgorithmType and SegmentAlgorithmName if necessary.
      switch (Segment.SegmentAlgorithmType) {
        case 'AUTOMATIC':
        case 'SEMIAUTOMATIC':
          if (!Segment.SegmentAlgorithmName) {
            throw new Error("If the SegmentAlgorithmType is SEMIAUTOMATIC or AUTOMATIC,\n            SegmentAlgorithmName must be provided");
          }

          break;
        case 'MANUAL':
          break;
        default:
          throw new Error("SegmentAlgorithmType " + Segment.SegmentAlgorithmType + " invalid.");
      }

      var SegmentSequence = this.dataset.SegmentSequence;
      Segment.SegmentNumber = SegmentSequence.length + 1;

      SegmentSequence.push(Segment);
    }
  }, {
    key: "removeSegment",
    value: function removeSegment(segmentNumber) {
      var SegmentSequence = this.dataset.SegmentSequence;

      // Remove the Segment
      SegmentSequence.splice(segmentNumber - 1, 1);

      // Alter the numbering of the following Segments.
      for (var i = segmentNumber - 1; i < SegmentSequence.length; i++) {
        SegmentSequence[i].SegmentNumber = i + 1;
      }
    }
  }]);

  return Segmentation;
}(DerivedPixels);

var StructuredReport = function (_DerivedDataset2) {
  _inherits(StructuredReport, _DerivedDataset2);

  function StructuredReport(datasets) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    _classCallCheck(this, StructuredReport);

    return _possibleConstructorReturn(this, (StructuredReport.__proto__ || Object.getPrototypeOf(StructuredReport)).call(this, datasets, options));
  }

  // this assumes a normalized multiframe input and will create
  // a multiframe derived image


  _createClass(StructuredReport, [{
    key: "derive",
    value: function derive() {
      _get(StructuredReport.prototype.__proto__ || Object.getPrototypeOf(StructuredReport.prototype), "derive", this).call(this);

      this.assignToDataset({
        "SOPClassUID": _DicomMetaDictionary.DicomMetaDictionary.sopClassUIDsByName.EnhancedSR,
        "Modality": "SR",
        "ValueType": "CONTAINER"
      });

      this.assignFromReference([]);
    }
  }]);

  return StructuredReport;
}(DerivedDataset);

exports.DerivedDataset = DerivedDataset;
exports.DerivedPixels = DerivedPixels;
exports.DerivedImage = DerivedImage;
exports.Segmentation = Segmentation;
exports.StructuredReport = StructuredReport;

/***/ })

})
//# sourceMappingURL=dcmjs.0e4923c5bfbe6637ef90.hot-update.js.map