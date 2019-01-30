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

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Segmentation = function () {
  function Segmentation() {
    _classCallCheck(this, Segmentation);
  }

  _createClass(Segmentation, null, [{
    key: "generateToolState",
    value: function generateToolState(stackOfImages, toolState) {}
  }, {
    key: "_setSegMetadata",
    value: function _setSegMetadata(segMetadata, idx, segment) {
      segMetadata[idx] = segment;

      modules.brush.setters.metadata(this._seriesInfo.seriesInstanceUid, idx, segment);
    }
  }, {
    key: "_addOneSegToCornerstoneToolState",
    value: function _addOneSegToCornerstoneToolState() {}
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
        xy: multiframe.Columns * multiframe.Rows
      };

      var segmentSequence = multiframe.SegmentSequence;
      var pixelData = dcmjs.data.BitArray.unpack(multiframe.PixelData);

      console.log(segmentSequence);

      console.log(multiframe);

      var segMetadata = [];

      var toolState = {};

      if (Array.isArray(segmentSequence)) {
        for (var i = 0; i < segmentSequence.length; i++) {
          segMetadata.push(segmentSequence[i]);

          /*
          for (let j = 0; j < dimensions.cube; j++) {
            mask[j] = pixelData[i * dimensions.cube + j];
          }
          */
        }
      } else {
        // Only one segment, will be stored as an object.
        segMetadata.push(segmentSequence);

        var segIndex = 0;

        for (var z = 0; z < imageIds.length; z++) {
          var imageId = imageIds[z];

          var imageIdSpecificToolState = {};

          imageIdSpecificToolState.brush = {};
          imageIdSpecificToolState.brush.data = [];
          imageIdSpecificToolState.brush.data[segIndex] = {
            invalidated: true,
            pixelData: new Uint8ClampedArray(dims.x * dims.y)
          };

          var cToolsPixelData = imageIdSpecificToolState.brush.data[segIndex].pixelData;

          for (var p = 0; p < dims.xy; p++) {
            cToolsPixelData[p] = pixelData[z * dims.xy + p];
          }

          toolState[imageId] = imageIdSpecificToolState;
        }

        console.log(toolState);

        /*
        for (let j = 0; j < dimensions.cube; j++) {
          mask[j] = pixelData[j];
        }
        */
      }

      // TODO -> return seg metadata and brush tool data.

      /*
      const { globalImageIdSpecificToolStateManager } = cornerstoneTools;
       for (let i = 0; i < imageIds.length; i++) {
        const imageId = imageIds[i];
        const byteOffset = width * height * i;
        const length = width * height;
        const slicePixelData = new Uint8ClampedArray(buffer, byteOffset, length);
         const toolData = [];
        toolData[segmentationIndex] = {
          pixelData: slicePixelData,
          invalidated: true
        };
         const toolState =
          globalImageIdSpecificToolStateManager.saveImageIdToolState(imageId) ||
          {};
         toolState[toolType] = {
          data: toolData
        };
         globalImageIdSpecificToolStateManager.restoreImageIdToolState(
          imageId,
          toolState
        );
      }
      */
    }
  }]);

  return Segmentation;
}();

exports.default = Segmentation;

/***/ })

})
//# sourceMappingURL=dcmjs.66f9903ce0579bf5b9bf.hot-update.js.map