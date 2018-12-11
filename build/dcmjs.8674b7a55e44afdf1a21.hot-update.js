webpackHotUpdatedcmjs("dcmjs",{

/***/ "./normalizers.js":
/*!************************!*\
  !*** ./normalizers.js ***!
  \************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DSRNormalizer = exports.SEGImageNormalizer = exports.PETImageNormalizer = exports.CTImageNormalizer = exports.EnhancedUSVolumeNormalizer = exports.EnhancedMRImageNormalizer = exports.EnhancedCTImageNormalizer = exports.MRImageNormalizer = exports.ImageNormalizer = exports.Normalizer = undefined;

var _get = function get(object, property, receiver) { if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { return get(parent, property, receiver); } } else if ("value" in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } };

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _DicomMetaDictionary = __webpack_require__(/*! ./DicomMetaDictionary.js */ "./DicomMetaDictionary.js");

var _derivations = __webpack_require__(/*! ./derivations.js */ "./derivations.js");

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Normalizer = function () {
  function Normalizer(datasets) {
    _classCallCheck(this, Normalizer);

    this.datasets = datasets; // one or more dicom-like object instances
    this.dataset = undefined; // a normalized multiframe dicom object instance
  }

  _createClass(Normalizer, [{
    key: 'normalize',
    value: function normalize() {
      return "No normalization defined";
    }
  }], [{
    key: 'consistentSOPClassUIDs',
    value: function consistentSOPClassUIDs(datasets) {
      // return sopClassUID if all exist and match, otherwise undefined
      var sopClassUID = void 0;
      datasets.forEach(function (dataset) {
        if (!dataset.SOPClassUID) {
          return undefined;
        }
        if (!sopClassUID) {
          sopClassUID = dataset.SOPClassUID;
        }
        if (dataset.SOPClassUID !== sopClassUID) {
          console.error('inconsistent sopClassUIDs: ', dataset.SOPClassUID, sopClassUID);
          return undefined;
        }
      });
      return sopClassUID;
    }
  }, {
    key: 'normalizerForSOPClassUID',
    value: function normalizerForSOPClassUID(sopClassUID) {
      sopClassUID = sopClassUID.replace(/[^0-9.]/g, ''); // TODO: clean all VRs as part of normalizing
      var toUID = _DicomMetaDictionary.DicomMetaDictionary.sopClassUIDsByName;
      var sopClassUIDMap = {};
      sopClassUIDMap[toUID.CTImage] = CTImageNormalizer;
      sopClassUIDMap[toUID.MRImage] = MRImageNormalizer;
      sopClassUIDMap[toUID.EnhancedCTImage] = EnhancedCTImageNormalizer;
      sopClassUIDMap[toUID.LegacyConvertedEnhancedCTImage] = EnhancedCTImageNormalizer;
      sopClassUIDMap[toUID.EnhancedMRImage] = EnhancedMRImageNormalizer;
      sopClassUIDMap[toUID.LegacyConvertedEnhancedMRImage] = EnhancedMRImageNormalizer;
      sopClassUIDMap[toUID.EnhancedUSVolume] = EnhancedUSVolumeNormalizer;
      sopClassUIDMap[toUID.PETImage] = PETImageNormalizer;
      sopClassUIDMap[toUID.EnhancedPETImage] = PETImageNormalizer;
      sopClassUIDMap[toUID.LegacyConvertedEnhancedPETImage] = PETImageNormalizer;
      sopClassUIDMap[toUID.Segmentation] = SEGImageNormalizer;
      sopClassUIDMap[toUID.DeformableSpatialRegistration] = DSRNormalizer;
      return sopClassUIDMap[sopClassUID];
    }
  }, {
    key: 'isMultiframe',
    value: function isMultiframe() {
      var ds = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : this.dataset;

      var sopClassUID = ds.SOPClassUID.replace(/[^0-9.]/g, ''); // TODO: clean all VRs as part of normalizing
      var toUID = _DicomMetaDictionary.DicomMetaDictionary.sopClassUIDsByName;
      var multiframeSOPClasses = [toUID.EnhancedMRImage, toUID.LegacyConvertedEnhancedMRImage, toUID.EnhancedCTImage, toUID.LegacyConvertedEnhancedCTImage, toUID.EnhancedUSVolume, toUID.EnhancedPETImage, toUID.LegacyConvertedEnhancedPETImage, toUID.Segmentation];
      return multiframeSOPClasses.indexOf(sopClassUID) !== -1;
    }
  }, {
    key: 'normalizeToDataset',
    value: function normalizeToDataset(datasets) {
      var sopClassUID = Normalizer.consistentSOPClassUIDs(datasets);
      var normalizerClass = Normalizer.normalizerForSOPClassUID(sopClassUID);
      if (!normalizerClass) {
        console.error('no normalizerClass for ', sopClassUID);
        return undefined;
      }
      var normalizer = new normalizerClass(datasets);
      normalizer.normalize();
      return normalizer.dataset;
    }
  }]);

  return Normalizer;
}();

var ImageNormalizer = function (_Normalizer) {
  _inherits(ImageNormalizer, _Normalizer);

  function ImageNormalizer() {
    _classCallCheck(this, ImageNormalizer);

    return _possibleConstructorReturn(this, (ImageNormalizer.__proto__ || Object.getPrototypeOf(ImageNormalizer)).apply(this, arguments));
  }

  _createClass(ImageNormalizer, [{
    key: 'normalize',
    value: function normalize() {
      this.convertToMultiframe();
      this.normalizeMultiframe();
    }
  }, {
    key: 'convertToMultiframe',
    value: function convertToMultiframe() {
      if (this.datasets.length === 1 && Normalizer.isMultiframe(this.datasets[0])) {
        // already a multiframe, so just use it
        this.dataset = this.datasets[0];
        return;
      }
      this.derivation = new _derivations.DerivedImage(this.datasets);
      this.dataset = this.derivation.dataset;
      var ds = this.dataset;
      // create a new multiframe from the source datasets
      // fill in only those elements required to make a valid image
      // for volumetric processing
      var referenceDataset = this.datasets[0];
      ds.NumberOfFrames = this.datasets.length;

      // TODO: develop sets of elements to copy over in loops
      ds.SOPClassUID = referenceDataset.SOPClassUID;
      ds.Rows = referenceDataset.Rows;
      ds.Columns = referenceDataset.Columns;
      ds.BitsAllocated = referenceDataset.BitsAllocated;
      ds.PixelRepresentation = referenceDataset.PixelRepresentation;
      ds.RescaleSlope = referenceDataset.RescaleSlope || "1";
      ds.RescaleIntercept = referenceDataset.RescaleIntercept || "0";
      //ds.BurnedInAnnotation = referenceDataset.BurnedInAnnotation || "YES";

      // sort
      // https://github.com/pieper/Slicer3/blob/master/Base/GUI/Tcl/LoadVolume.tcl
      // TODO: add spacing checks:
      // https://github.com/Slicer/Slicer/blob/master/Modules/Scripted/DICOMPlugins/DICOMScalarVolumePlugin.py#L228-L250
      // TODO: put this information into the Shared and PerFrame functional groups
      // TODO: sorting of frames could happen in normalizeMultiframe instead, since other
      // multiframe converters may not sort the images
      // TODO: sorting can be seen as part of generation of the Dimension Multiframe Dimension Module
      // and should really be done in an acquisition-specific way (e.g. for DCE)
      var referencePosition = referenceDataset.ImagePositionPatient;
      var rowVector = referenceDataset.ImageOrientationPatient.slice(0, 3);
      var columnVector = referenceDataset.ImageOrientationPatient.slice(3, 6);
      var scanAxis = ImageNormalizer.vec3CrossProduct(rowVector, columnVector);
      var distanceDatasetPairs = [];
      this.datasets.forEach(function (dataset) {
        var position = dataset.ImagePositionPatient.slice();
        var positionVector = ImageNormalizer.vec3Subtract(position, referencePosition);
        var distance = ImageNormalizer.vec3Dot(positionVector, scanAxis);
        distanceDatasetPairs.push([distance, dataset]);
      });
      distanceDatasetPairs.sort(function (a, b) {
        return b[0] - a[0];
      });

      // assign array buffers
      if (ds.BitsAllocated !== 16) {
        console.error('Only works with 16 bit data, not ' + String(dataset.BitsAllocated));
      }
      if (referenceDataset._vrMap && !referenceDataset._vrMap.PixelData) {
        console.warn('No vr map given for pixel data, using OW');
        ds._vrMap = { 'PixelData': 'OW' };
      } else {
        ds._vrMap = { 'PixelData': referenceDataset._vrMap.PixelData };
      }
      var frameSize = referenceDataset.PixelData.byteLength;
      ds.PixelData = new ArrayBuffer(ds.NumberOfFrames * frameSize);
      var frame = 0;
      distanceDatasetPairs.forEach(function (pair) {
        var _pair = _slicedToArray(pair, 2),
            distance = _pair[0],
            dataset = _pair[1];

        var pixels = new Uint16Array(dataset.PixelData);
        var frameView = new Uint16Array(ds.PixelData, frame * frameSize, frameSize / 2);
        try {
          frameView.set(pixels);
        } catch (e) {
          if (e instanceof RangeError) {
            console.error("Error inserting pixels in PixelData");
            console.error("frameSize", frameSize);
            console.error("NumberOfFrames", ds.NumberOfFrames);
            console.error("pair", pair);
            console.error("dataset PixelData size", dataset.PixelData.length);
          }
        }
        frame++;
      });

      if (ds.NumberOfFrames < 2) {
        // TODO
        console.error('Cannot populate shared groups uniquely without multiple frames');
      }

      var _distanceDatasetPairs = _slicedToArray(distanceDatasetPairs[0], 2),
          distance0 = _distanceDatasetPairs[0],
          dataset0 = _distanceDatasetPairs[1];

      var _distanceDatasetPairs2 = _slicedToArray(distanceDatasetPairs[1], 2),
          distance1 = _distanceDatasetPairs2[0],
          dataset1 = _distanceDatasetPairs2[1];

      //
      // make the functional groups
      //

      // shared

      ds.SharedFunctionalGroupsSequence = {
        PlaneOrientationSequence: {
          ImageOrientationPatient: dataset0.ImageOrientationPatient
        },
        PixelMeasuresSequence: {
          PixelSpacing: dataset0.PixelSpacing,
          SpacingBetweenSlices: Math.abs(distance1 - distance0)
        }
      };

      // per-frame

      ds.PerFrameFunctionalGroupsSequence = [];
      distanceDatasetPairs.forEach(function (pair) {
        ds.PerFrameFunctionalGroupsSequence.push({
          PlanePositionSequence: {
            ImagePositionPatient: pair[1].ImagePositionPatient
          }
        });
      });

      ds.ReferencedSeriesSequence = {
        SeriesInstanceUID: dataset0.SeriesInstanceUID,
        ReferencedInstanceSequence: []
      };

      // copy over each datasets window/level into the per-frame groups
      // and set the referenced series uid
      this.datasets.forEach(function (dataset, datasetIndex) {
        ds.PerFrameFunctionalGroupsSequence.push;

        ds.PerFrameFunctionalGroupsSequence[datasetIndex].FrameVOILUTSequence = {
          WindowCenter: dataset.WindowCenter,
          WindowWidth: dataset.WindowWidth
        };
        ds.ReferencedSeriesSequence.ReferencedInstanceSequence.push({
          ReferencedSOPClass: dataset.SOPClassUID,
          ReferencedSOPInstanceUID: dataset.SOPInstanceUID
        });
      });

      var dimensionUID = _DicomMetaDictionary.DicomMetaDictionary.uid();
      this.dataset.DimensionOrganizationSequence = {
        DimensionOrganizationUID: dimensionUID
      };
      this.dataset.DimensionIndexSequence = [{
        DimensionOrganizationUID: dimensionUID,
        DimensionIndexPointer: 2097202,
        FunctionalGroupPointer: 2134291, // PlanePositionSequence
        DimensionDescriptionLabel: "ImagePositionPatient"
      }];
    }
  }, {
    key: 'normalizeMultiframe',
    value: function normalizeMultiframe() {
      var ds = this.dataset;
      if (!ds.NumberOfFrames) {
        console.error("Missing number or frames not supported");
        return;
      }
      if (Number(ds.NumberOfFrames) === 1) {
        console.error("Single frame instance of multiframe class not supported");
        return;
      }
      if (!ds.PixelRepresentation) {
        // Required tag: guess signed
        ds.PixelRepresentation = 1;
      }
      if (!ds.StudyID || ds.StudyID === "") {
        // Required tag: fill in if needed
        ds.StudyID = "No Study ID";
      }

      var validLateralities = ["R", "L"];
      if (validLateralities.indexOf(ds.Laterality) === -1) {
        delete ds.Laterality;
      }

      if (!ds.PresentationLUTShape) {
        ds.PresentationLUTShape = "IDENTITY";
      }

      if (!ds.SharedFunctionalGroupsSequence) {
        console.error('Can only process multiframe data with SharedFunctionalGroupsSequence');
      }

      // TODO: special case!
      if (ds.BodyPartExamined === "PROSTATE") {
        ds.SharedFunctionalGroupsSequence.FrameAnatomySequence = {
          AnatomicRegionSequence: {
            CodeValue: "T-9200B",
            CodingSchemeDesignator: "SRT",
            CodeMeaning: "Prostate"
          },
          FrameLaterality: "U"
        };
      }

      var rescaleIntercept = ds.RescaleIntercept || 0;
      var rescaleSlope = ds.RescaleSlope || 1;
      ds.SharedFunctionalGroupsSequence.PixelValueTransformationSequence = {
        RescaleIntercept: rescaleIntercept,
        RescaleSlope: rescaleSlope,
        RescaleType: "US"
      };

      var frameNumber = 1;
      this.datasets.forEach(function (dataset) {
        ds.PerFrameFunctionalGroupsSequence[frameNumber - 1].FrameContentSequence = {
          FrameAcquisitionDuration: 0,
          StackID: 1,
          InStackPositionNumber: frameNumber,
          DimensionIndexValues: frameNumber
        };
        var frameTime = dataset.AcquisitionDate + dataset.AcquisitionTime;
        if (!isNaN(frameTime)) {
          var frameContentSequence = ds.PerFrameFunctionalGroupsSequence[frameNumber - 1].FrameContentSequence;
          frameContentSequence.FrameAcquisitionDateTime = frameTime;
          frameContentSequence.FrameReferenceDateTime = frameTime;
        }
        frameNumber++;
      });

      //
      // TODO: convert this to shared functional group not top level element
      //
      if (ds.WindowCenter && ds.WindowWidth) {
        // if they exist as single values, make them lists for consistency
        if (!Array.isArray(ds.WindowCenter)) {
          ds.WindowCenter = [ds.WindowCenter];
        }
        if (!Array.isArray(ds.WindowWidth)) {
          ds.WindowWidth = [ds.WindowWidth];
        }
      }
      if (!ds.WindowCenter || !ds.WindowWidth) {
        // if they don't exist, make them empty lists and try to initialize them
        ds.WindowCenter = []; // both must exist and be the same length
        ds.WindowWidth = [];
        // provide a volume-level window/level guess (mean of per-frame)
        if (ds.PerFrameFunctionalGroupsSequence) {
          var wcww = { center: 0, width: 0, count: 0 };
          ds.PerFrameFunctionalGroupsSequence.forEach(function (functionalGroup) {
            if (functionalGroup.FrameVOILUT) {
              var wc = functionalGroup.FrameVOILUTSequence.WindowCenter;
              var ww = functionalGroup.FrameVOILUTSequence.WindowWidth;
              if (functionalGroup.FrameVOILUTSequence && wc && ww) {
                if (Array.isArray(wc)) {
                  wc = wc[0];
                }
                if (Array.isArray(ww)) {
                  ww = ww[0];
                }
                wcww.center += Number(wc);
                wcww.width += Number(ww);
                wcww.count++;
              }
            }
          });
          if (wcww.count > 0) {
            ds.WindowCenter.push(String(wcww.center / wcww.count));
            ds.WindowWidth.push(String(wcww.width / wcww.count));
          }
        }
      }
      // last gasp, pick an arbitrary default
      if (ds.WindowCenter.length === 0) {
        ds.WindowCenter = [300];
      }
      if (ds.WindowWidth.length === 0) {
        ds.WindowWidth = [500];
      }
    }
  }], [{
    key: 'vec3CrossProduct',
    value: function vec3CrossProduct(a, b) {
      var ax = a[0],
          ay = a[1],
          az = a[2],
          bx = b[0],
          by = b[1],
          bz = b[2];
      var out = [];
      out[0] = ay * bz - az * by;
      out[1] = az * bx - ax * bz;
      out[2] = ax * by - ay * bx;
      return out;
    }
  }, {
    key: 'vec3Subtract',
    value: function vec3Subtract(a, b) {
      var out = [];
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      return out;
    }
  }, {
    key: 'vec3Dot',
    value: function vec3Dot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }
  }]);

  return ImageNormalizer;
}(Normalizer);

var MRImageNormalizer = function (_ImageNormalizer) {
  _inherits(MRImageNormalizer, _ImageNormalizer);

  function MRImageNormalizer() {
    _classCallCheck(this, MRImageNormalizer);

    return _possibleConstructorReturn(this, (MRImageNormalizer.__proto__ || Object.getPrototypeOf(MRImageNormalizer)).apply(this, arguments));
  }

  _createClass(MRImageNormalizer, [{
    key: 'normalize',
    value: function normalize() {
      _get(MRImageNormalizer.prototype.__proto__ || Object.getPrototypeOf(MRImageNormalizer.prototype), 'normalize', this).call(this);
      // TODO: make specialization for LegacyConverted vs normal EnhanceMRImage
      var toUID = _DicomMetaDictionary.DicomMetaDictionary.sopClassUIDsByName;
      this.dataset.SOPClassUID = "LegacyConvertedEnhancedMRImage";
      //this.dataset.SOPClassUID = toUID.EnhancedMRImage;
    }
  }, {
    key: 'normalizeMultiframe',
    value: function normalizeMultiframe() {
      _get(MRImageNormalizer.prototype.__proto__ || Object.getPrototypeOf(MRImageNormalizer.prototype), 'normalizeMultiframe', this).call(this);
      var ds = this.dataset;

      if (!ds.ImageType || !ds.ImageType.constructor || ds.ImageType.constructor.name != "Array" || ds.ImageType.length != 4) {
        ds.ImageType = ["ORIGINAL", "PRIMARY", "OTHER", "NONE"];
      }

      ds.SharedFunctionalGroupsSequence.MRImageFrameType = {
        FrameType: ds.ImageType,
        PixelPresentation: "MONOCHROME",
        VolumetricProperties: "VOLUME",
        VolumeBasedCalculationTechnique: "NONE",
        ComplexImageComponent: "MAGNITUDE",
        AcquisitionContrast: "UNKNOWN"
      };
    }
  }]);

  return MRImageNormalizer;
}(ImageNormalizer);

var EnhancedCTImageNormalizer = function (_ImageNormalizer2) {
  _inherits(EnhancedCTImageNormalizer, _ImageNormalizer2);

  function EnhancedCTImageNormalizer() {
    _classCallCheck(this, EnhancedCTImageNormalizer);

    return _possibleConstructorReturn(this, (EnhancedCTImageNormalizer.__proto__ || Object.getPrototypeOf(EnhancedCTImageNormalizer)).apply(this, arguments));
  }

  _createClass(EnhancedCTImageNormalizer, [{
    key: 'normalize',
    value: function normalize() {
      _get(EnhancedCTImageNormalizer.prototype.__proto__ || Object.getPrototypeOf(EnhancedCTImageNormalizer.prototype), 'normalize', this).call(this);
    }
  }]);

  return EnhancedCTImageNormalizer;
}(ImageNormalizer);

var EnhancedMRImageNormalizer = function (_ImageNormalizer3) {
  _inherits(EnhancedMRImageNormalizer, _ImageNormalizer3);

  function EnhancedMRImageNormalizer() {
    _classCallCheck(this, EnhancedMRImageNormalizer);

    return _possibleConstructorReturn(this, (EnhancedMRImageNormalizer.__proto__ || Object.getPrototypeOf(EnhancedMRImageNormalizer)).apply(this, arguments));
  }

  _createClass(EnhancedMRImageNormalizer, [{
    key: 'normalize',
    value: function normalize() {
      _get(EnhancedMRImageNormalizer.prototype.__proto__ || Object.getPrototypeOf(EnhancedMRImageNormalizer.prototype), 'normalize', this).call(this);
    }
  }]);

  return EnhancedMRImageNormalizer;
}(ImageNormalizer);

var EnhancedUSVolumeNormalizer = function (_ImageNormalizer4) {
  _inherits(EnhancedUSVolumeNormalizer, _ImageNormalizer4);

  function EnhancedUSVolumeNormalizer() {
    _classCallCheck(this, EnhancedUSVolumeNormalizer);

    return _possibleConstructorReturn(this, (EnhancedUSVolumeNormalizer.__proto__ || Object.getPrototypeOf(EnhancedUSVolumeNormalizer)).apply(this, arguments));
  }

  _createClass(EnhancedUSVolumeNormalizer, [{
    key: 'normalize',
    value: function normalize() {
      _get(EnhancedUSVolumeNormalizer.prototype.__proto__ || Object.getPrototypeOf(EnhancedUSVolumeNormalizer.prototype), 'normalize', this).call(this);
    }
  }]);

  return EnhancedUSVolumeNormalizer;
}(ImageNormalizer);

var CTImageNormalizer = function (_ImageNormalizer5) {
  _inherits(CTImageNormalizer, _ImageNormalizer5);

  function CTImageNormalizer() {
    _classCallCheck(this, CTImageNormalizer);

    return _possibleConstructorReturn(this, (CTImageNormalizer.__proto__ || Object.getPrototypeOf(CTImageNormalizer)).apply(this, arguments));
  }

  _createClass(CTImageNormalizer, [{
    key: 'normalize',
    value: function normalize() {
      _get(CTImageNormalizer.prototype.__proto__ || Object.getPrototypeOf(CTImageNormalizer.prototype), 'normalize', this).call(this);
      // TODO: provide option at export to swap in LegacyConverted UID
      var toUID = _DicomMetaDictionary.DicomMetaDictionary.sopClassUIDsByName;
      //this.dataset.SOPClassUID = "LegacyConvertedEnhancedCTImage";
      this.dataset.SOPClassUID = toUID.EnhancedCTImage;
    }
  }]);

  return CTImageNormalizer;
}(ImageNormalizer);

var PETImageNormalizer = function (_ImageNormalizer6) {
  _inherits(PETImageNormalizer, _ImageNormalizer6);

  function PETImageNormalizer() {
    _classCallCheck(this, PETImageNormalizer);

    return _possibleConstructorReturn(this, (PETImageNormalizer.__proto__ || Object.getPrototypeOf(PETImageNormalizer)).apply(this, arguments));
  }

  _createClass(PETImageNormalizer, [{
    key: 'normalize',
    value: function normalize() {
      _get(PETImageNormalizer.prototype.__proto__ || Object.getPrototypeOf(PETImageNormalizer.prototype), 'normalize', this).call(this);
      // TODO: provide option at export to swap in LegacyConverted UID
      var toUID = _DicomMetaDictionary.DicomMetaDictionary.sopClassUIDsByName;
      //this.dataset.SOPClassUID = "LegacyConvertedEnhancedPETImage";
      this.dataset.SOPClassUID = toUID.EnhancedPETImage;
    }
  }]);

  return PETImageNormalizer;
}(ImageNormalizer);

var SEGImageNormalizer = function (_ImageNormalizer7) {
  _inherits(SEGImageNormalizer, _ImageNormalizer7);

  function SEGImageNormalizer() {
    _classCallCheck(this, SEGImageNormalizer);

    return _possibleConstructorReturn(this, (SEGImageNormalizer.__proto__ || Object.getPrototypeOf(SEGImageNormalizer)).apply(this, arguments));
  }

  _createClass(SEGImageNormalizer, [{
    key: 'normalize',
    value: function normalize() {
      _get(SEGImageNormalizer.prototype.__proto__ || Object.getPrototypeOf(SEGImageNormalizer.prototype), 'normalize', this).call(this);
    }
  }]);

  return SEGImageNormalizer;
}(ImageNormalizer);

var DSRNormalizer = function (_Normalizer2) {
  _inherits(DSRNormalizer, _Normalizer2);

  function DSRNormalizer() {
    _classCallCheck(this, DSRNormalizer);

    return _possibleConstructorReturn(this, (DSRNormalizer.__proto__ || Object.getPrototypeOf(DSRNormalizer)).apply(this, arguments));
  }

  _createClass(DSRNormalizer, [{
    key: 'normalize',
    value: function normalize() {
      this.dataset = this.datasets[0]; // only one dataset per series and for now we assume it is normalized
    }
  }]);

  return DSRNormalizer;
}(Normalizer);

exports.Normalizer = Normalizer;
exports.ImageNormalizer = ImageNormalizer;
exports.MRImageNormalizer = MRImageNormalizer;
exports.EnhancedCTImageNormalizer = EnhancedCTImageNormalizer;
exports.EnhancedMRImageNormalizer = EnhancedMRImageNormalizer;
exports.EnhancedUSVolumeNormalizer = EnhancedUSVolumeNormalizer;
exports.CTImageNormalizer = CTImageNormalizer;
exports.PETImageNormalizer = PETImageNormalizer;
exports.SEGImageNormalizer = SEGImageNormalizer;
exports.DSRNormalizer = DSRNormalizer;

/***/ })

})
//# sourceMappingURL=dcmjs.8674b7a55e44afdf1a21.hot-update.js.map