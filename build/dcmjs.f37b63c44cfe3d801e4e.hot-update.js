webpackHotUpdatedcmjs("dcmjs",{

/***/ "./adapters/Cornerstone/Segmentation.js":
/*!**********************************************!*\
  !*** ./adapters/Cornerstone/Segmentation.js ***!
  \**********************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _bitArray = __webpack_require__(/*! ../../bitArray.js */ "./bitArray.js");

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Segmentation = function () {
  function Segmentation() {
    _classCallCheck(this, Segmentation);
  }

  _createClass(Segmentation, null, [{
    key: "generateToolState",
    value: function generateToolState(imageIds, images, brushData) {
      // NOTE: here be dragons. Currently if a brush has been used and then erased,
      // This will flag up as a segmentation, even though its full of zeros.
      // Fixing this cleanly really requires an update of cornerstoneTools.

      console.log("testButton");

      var toolState = brushData.toolState,
          segments = brushData.segments;


      console.log("test2");

      console.log(images);

      var image0 = images[0];

      var dims = {
        x: image0.columns,
        y: image0.rows,
        z: imageIds.length
      };

      dims.xy = dims.x * dims.y;
      dims.xyz = dims.xy * dims.z;

      var multiframe = imageIds[0].includes("?frame");

      var seg = Segmentation.createSegFromImages(images, multiframe);
      var numSegments = Segmentation.addMetaDataToSegAndGetSegCount(seg, segments);

      var cToolsPixelData = new Uint8ClampedArray(dims.xyz * numSegments);

      if (!numSegments) {
        throw new Warning("No segments to export!");
      }

      var currentSeg = 0;

      for (var segIdx = 0; segIdx < segments.length; segIdx++) {
        if (!segments[segIdx]) {
          continue;
        }

        for (var z = 0; z < imageIds.length; z++) {
          var imageIdSpecificToolState = toolState[imageIds[z]];

          if (imageIdSpecificToolState && imageIdSpecificToolState.brush && imageIdSpecificToolState.brush.data) {
            var pixelData = imageIdSpecificToolState.brush.data[segIdx].pixelData;

            for (var p = 0; p < dims.xy; p++) {
              cToolsPixelData[currentSeg * dims.xyz + z * dims.xy + p] = pixelData[p];
            }
          }
        }

        currentSeg++;
      }

      console.log(cToolsPixelData);

      var dataSet = seg.dataset;

      // Re-define the PixelData ArrayBuffer to be the correct length
      // => segments * rows * columns * slices / 8 (As 8 bits/byte)
      seg.dataset.PixelData = new ArrayBuffer(numSegments * dims.xyz / 8);

      var pixelDataUint8View = new Uint8Array(seg.dataset.PixelData);
      var bitPackedcToolsData = _bitArray.BitArray.pack(cToolsPixelData);

      console.log(pixelDataUint8View.length === bitPackedcToolsData.length);

      for (var i = 0; i < pixelDataUint8View.length; i++) {
        pixelDataUint8View[i] = bitPackedcToolsData[i];
      }

      console.log(pixelDataUint8View);

      var segBlob = dcmjs.data.datasetToBlob(seg.dataset);

      return segBlob;
    }
  }, {
    key: "addMetaDataToSegAndGetSegCount",
    value: function addMetaDataToSegAndGetSegCount(seg, segments) {
      var numSegments = 0;

      for (var i = 0; i < segments.length; i++) {
        if (segments[i]) {
          numSegments++;

          seg.addSegment(segments[i]);
        }
      }

      return numSegments;
    }

    /**
     * @static createSegFromImages - description
     *
     * @param  {object} images       description
     * @param  {Boolean} isMultiframe description
     * @returns {dataSet}              description
     */

  }, {
    key: "createSegFromImages",
    value: function createSegFromImages(images, isMultiframe) {
      var datasets = [];

      if (isMultiframe) {
        var image = images[0];
        var arrayBuffer = image.data.byteArray.buffer;

        var _dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
        var dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(_dicomData.dict);

        dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(_dicomData.meta);

        datasets.push(dataset);
      } else {
        for (var i = 0; i < images.length; i++) {
          var _image = images[i];
          var _arrayBuffer = _image.data.byteArray.buffer;
          var _dicomData2 = dcmjs.data.DicomMessage.readFile(_arrayBuffer);
          var _dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(_dicomData2.dict);

          _dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(_dicomData2.meta);
          datasets.push(_dataset);
        }
      }

      var multiframe = dcmjs.normalizers.Normalizer.normalizeToDataset(datasets);

      return new dcmjs.derivations.Segmentation([multiframe]);
    }
  }, {
    key: "readToolState",
    value: function readToolState(imageIds, arrayBuffer) {
      dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
      var dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);
      dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(dicomData.meta);
      var multiframe = dcmjs.normalizers.Normalizer.normalizeToDataset([dataset]);

      var dims = {
        x: multiframe.Columns,
        y: multiframe.Rows,
        z: imageIds.length,
        xy: multiframe.Columns * multiframe.Rows,
        xyz: multiframe.Columns * multiframe.Rows * imageIds.length
      };

      var segmentSequence = multiframe.SegmentSequence;
      var pixelData = dcmjs.data.BitArray.unpack(multiframe.PixelData);

      //console.log(segmentSequence);

      //console.log(multiframe);

      var segMetadata = {
        seriesInstanceUid: multiframe.SeriesInstanceUid,
        data: []
      };

      var toolState = {};

      if (Array.isArray(segmentSequence)) {
        var segCount = segmentSequence.length;

        for (var z = 0; z < imageIds.length; z++) {
          var imageId = imageIds[z];

          var imageIdSpecificToolState = {};

          imageIdSpecificToolState.brush = {};
          imageIdSpecificToolState.brush.data = [];

          var brushData = imageIdSpecificToolState.brush.data;

          for (var i = 0; i < segCount; i++) {
            brushData[i] = {
              invalidated: true,
              pixelData: new Uint8ClampedArray(dims.x * dims.y)
            };
          }

          toolState[imageId] = imageIdSpecificToolState;
        }

        for (var segIdx = 0; segIdx < segmentSequence.length; segIdx++) {
          segMetadata.data.push(segmentSequence[segIdx]);

          for (var _z = 0; _z < imageIds.length; _z++) {
            var _imageId = imageIds[_z];

            var cToolsPixelData = toolState[_imageId].brush.data[segIdx].pixelData;

            for (var p = 0; p < dims.xy; p++) {
              cToolsPixelData[p] = pixelData[segIdx * dims.xyz + _z * dims.xy + p];
            }
          }
        }
      } else {
        // Only one segment, will be stored as an object.
        segMetadata.data.push(segmentSequence);

        var _segIdx = 0;

        for (var _z2 = 0; _z2 < imageIds.length; _z2++) {
          var _imageId2 = imageIds[_z2];

          var _imageIdSpecificToolState = {};

          _imageIdSpecificToolState.brush = {};
          _imageIdSpecificToolState.brush.data = [];
          _imageIdSpecificToolState.brush.data[_segIdx] = {
            invalidated: true,
            pixelData: new Uint8ClampedArray(dims.x * dims.y)
          };

          var _cToolsPixelData = _imageIdSpecificToolState.brush.data[_segIdx].pixelData;

          for (var _p = 0; _p < dims.xy; _p++) {
            _cToolsPixelData[_p] = pixelData[_z2 * dims.xy + _p];
          }

          toolState[_imageId2] = _imageIdSpecificToolState;
        }
      }

      //console.log(toolState);

      // TODO -> return seg metadata and brush tool data.

      return { toolState: toolState, segMetadata: segMetadata };
    }
  }]);

  return Segmentation;
}();

exports.default = Segmentation;

/***/ })

})
//# sourceMappingURL=dcmjs.f37b63c44cfe3d801e4e.hot-update.js.map