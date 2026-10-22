'use strict';
/* The Content-Security-Policy sent with JARVIS's own pages (index.html and lock.html). It does not change what JARVIS does; it limits what a script that should
   not be there could do:
     scripts      only this program's own files, plus the CDN the camera libraries come from (and those are fingerprinted, see cdnpins.js); no inline scripts.
                  'unsafe-eval' IS allowed because OpenCV.js creates functions from strings (found by loading it under a stricter policy): it lets a script that
                  is already allowed build code from text, but still lets no foreign or inline script in.
     connections  only back to this server, plus the places the libraries fetch their data from (face models, hand model, WebAssembly files)
     frames/forms/<base>/plugins   none / this site / this site / none; and no other site may put JARVIS in a frame (clickjacking)
   Inline STYLES are allowed (the page sets styles from script) and images may come from anywhere over https (answers can show a picture).
   buildCsp() is plain text assembly so the policy is tested; server.js sets it as a response header on the HTML pages only. */
const CDN = 'https://cdn.jsdelivr.net';
function buildCsp() {
  const d = {
    'default-src': ["'self'"],
    'script-src': ["'self'", CDN, "'wasm-unsafe-eval'", "'unsafe-eval'"],      // unsafe-eval: OpenCV (the scanner) builds its functions with new Function — tested live; inline scripts stay blocked
    'style-src': ["'self'", "'unsafe-inline'", CDN],
    'font-src': ["'self'", 'data:', CDN],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'blob:', 'data:'],
    'connect-src': ["'self'", 'data:', CDN, 'https://storage.googleapis.com'],      // data: = reading an embedded file (OpenCV's WebAssembly is inside the script); no network
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(d).map(([k, v]) => k + ' ' + v.join(' ')).join('; ');
}
// the paths that are JARVIS's own HTML pages
const isPagePath = p => /^\/(?:index\.html|lock\.html|phonehub\.html)?$/i.test(String(p || ''));
module.exports = { buildCsp, isPagePath, CDN };
