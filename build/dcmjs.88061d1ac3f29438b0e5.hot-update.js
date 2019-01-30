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
    value: function generateToolState(dataset) {
      // For now, bail out if the dataset is not a TID1500 SR with length measurements
      /*
      if (dataset) {
        throw new Error("This package is only meant to ");
      }
      */

      var _cornerstoneTools = cornerstoneTools,
          globalImageIdSpecificToolStateManager = _cornerstoneTools.globalImageIdSpecificToolStateManager;


      for (var i = 0; i < imageIds.length; i++) {
        var imageId = imageIds[i];
        var byteOffset = width * height * i;
        var length = width * height;
        var slicePixelData = new Uint8ClampedArray(buffer, byteOffset, length);

        var toolData = [];
        toolData[segmentationIndex] = {
          pixelData: slicePixelData,
          invalidated: true
        };

        var toolState = globalImageIdSpecificToolStateManager.saveImageIdToolState(imageId) || {};

        toolState[toolType] = {
          data: toolData
        };

        globalImageIdSpecificToolStateManager.restoreImageIdToolState(imageId, toolState);
      }
    }
  }]);

  return Segmentation;
}();

exports.default = Segmentation;

/***/ })

})
//# sourceMappingURL=dcmjs.88061d1ac3f29438b0e5.hot-update.js.map