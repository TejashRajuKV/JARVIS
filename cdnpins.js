'use strict';
/* The few program files JARVIS fetches from the internet on first use (the document scanner, QR reader and face detector), each with the fingerprint of the
   exact file it was tested with (Subresource Integrity, sha256). The browser refuses to run a file whose fingerprint differs, so a hacked or swapped CDN copy
   cannot run inside the page that controls your laptop. The fingerprints come from jsDelivr's published file list for these exact versions
   (https://data.jsdelivr.com/v1/packages/npm/<package>@<version>?structure=flat). When a version is changed in the code, its line here has to change too;
   tests/csp.test.js fails if a URL used in the code has no fingerprint.
   Not covered: the hand-gesture library (loaded as an ES module with import(), which has no integrity check) and the data files those libraries download
   themselves (face models, WebAssembly) — those can only be limited by the page's Content-Security-Policy (csp.js), not fingerprinted. */
const CdnPins = {
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js': 'sha256-GbRhZ7We+++cw4NiZLC2VxEIM+Sx34QoIAS4sxQcBI0=',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js': 'sha256-vEDIoVGWI2sjFNsIVvcsoLSZgM1UE7jIUqc0n1/uCFk=',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.js': 'sha256-xIWdpakIqn5QNQJuam7idbZf+3m/biOu7pMLr6Wdzfw=',
};
if (typeof module !== 'undefined') module.exports = CdnPins;
