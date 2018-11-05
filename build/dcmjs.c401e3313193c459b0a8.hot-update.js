webpackHotUpdatedcmjs("dcmjs",{

/***/ "./bitArray.js":
/*!*********************!*\
  !*** ./bitArray.js ***!
  \*********************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, "__esModule", {
  value: true
});
/* eslint no-bitwise: 0 */

var BitArray = {
  getBytesForBinaryFrame: getBytesForBinaryFrame,
  pack: pack,
  unpack: unpack
};

exports.BitArray = BitArray;


function getBytesForBinaryFrame(numPixels) {
  // Check whether the 1-bit pixels exactly fit into bytes
  var remainder = numPixels % 8;

  // Number of bytes that work on an exact fit
  var bytesRequired = Math.floor(numPixels / 8);

  // Add one byte if we have a remainder
  if (remainder > 0) {
    bytesRequired++;
  }

  return bytesRequired;
}

function pack(pixelData) {
  var numPixels = pixelData.length;
  console.log('numPixels: ' + numPixels);

  var length = getBytesForBinaryFrame(numPixels);
  //console.log('getBytesForBinaryFrame: ' + length);

  var bitPixelData = new Uint8Array(length);

  var bytePos = 0;

  for (var i = 0; i < numPixels; i++) {
    // Compute byte position
    bytePos = Math.floor(i / 8);

    var pixValue = pixelData[i] !== 0;

    //console.log('i: ' + i);
    //console.log('pixValue: ' + pixValue);
    //console.log('bytePos: ' + bytePos);

    var bitPixelValue = pixValue << i % 8;
    //console.log('current bitPixelData: ' + bitPixelData[bytePos]);
    //console.log('this bitPixelValue: ' + bitPixelValue);

    bitPixelData[bytePos] |= bitPixelValue;

    //console.log('new bitPixelValue: ' + bitPixelData[bytePos]);
  }

  return bitPixelData;
}

// convert a packed bitwise pixel array into a byte-per-pixel
// array with 255 corresponding to each set bit in the bit array
function unpack(bitPixelArray) {
  var bitArray = new Uint8Array(bitPixelArray);
  var byteArray = new Uint8Array(8 * bitArray.length);

  for (var byteIndex = 0; byteIndex < byteArray.length; byteIndex++) {
    var bitIndex = byteIndex % 8;
    var bitByteIndex = Math.floor(byteIndex / 8);
    byteArray[byteIndex] = 255 * ((bitArray[bitByteIndex] & 1 << bitIndex) >> bitIndex);
  }

  return byteArray;
}

/***/ })

})
//# sourceMappingURL=dcmjs.c401e3313193c459b0a8.hot-update.js.map