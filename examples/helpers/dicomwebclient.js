/**
 * Copied from https://github.com/dcmjs-org/dicomweb-client
 *
 * @param {*} url  the URL of the destination host
 * @param {*} method type of HTTP Method (GET, POST, ...)
 * @param {*} headers http request header options like { 'Accept': 'multipart/related; type="application/octet-stream"' } to receive a byte stream
 * @param {*} options options which can include some json-objects like 'responseType' or 'progressCallback'
 */
function httpRequest(url, method, headers, options={}) {
    return new Promise( (resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open(method, url, true);
      if ('responseType' in options) {
        request.responseType = options.responseType;
      }

      if (typeof(headers) === 'object') {
        Object.keys(headers).forEach(function (key) {
          request.setRequestHeader(key, headers[key]);
        });
      }

      // now add custom headers from the user
      // (e.g. access tokens)
      const userHeaders = headers;
      Object.keys(userHeaders).forEach(function (key) {
        request.setRequestHeader(key, userHeaders[key]);
      });

      // Event triggered when upload starts
      request.onloadstart = function (event) {
        // console.log('upload started: ', url)
      };

      // Event triggered when upload ends
      request.onloadend = function (event) {
        // console.log('upload finished')
      };

      // Handle response message
      request.onreadystatechange = function (event) {
        if (request.readyState === 4) {
          if (request.status === 200) {
            resolve(request.response);
          } else if (request.status === 202) {
            console.warn('some resources already existed: ', request);
            resolve(request.response);
          } else if (request.status === 204) {
            console.warn('empty response for request: ', request);
            resolve([]);
          } else {
            console.error('request failed: ', request);
            reject(request);
          }
        }
      };

      // Event triggered while download progresses
      if ('progressCallback' in options) {
        if (typeof(options.progressCallback) === 'function') {
          request.onprogress = options.progressCallback();
        }
      }

      if ('data' in options) {
        request.send(options.data);
      } else {
        request.send();
      }
    });
  }