// Priority 5 verification: Clean startup, dependency requirements, and graceful fallbacks
// when Ollama, optional cloud providers, or CDN/camera helper libraries are offline or missing.
// Run: node tests/offline-fallbacks.test.js
'use strict';
const fs = require('fs'), path = require('path');
const root = f => path.join(__dirname, '..', f);

const N = require(root('nodecheck.js'));
const H = require(root('aihealth.js'));
const createLLM = require(root('llm.js'));
const Pins = require(root('cdnpins.js'));

let fail = 0, total = 0;
const check = (n, ok, x) => {
  total++;
  if (!ok) {
    fail++;
    console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : ''));
  }
};

(async () => {
  /* ---------------- 1. Startup & Engine Requirements ---------------- */
  const pkg = JSON.parse(fs.readFileSync(root('package.json'), 'utf8'));
  check('startup: package.json requires Node >=22', pkg.engines && pkg.engines.node === '>=22');
  check('startup: nodecheck rejects Node 18 and 20', !N.check('18.20.0').ok && !N.check('20.10.0').ok);
  check('startup: nodecheck accepts Node 22 and 24', N.check('22.12.0').ok && N.check('24.0.0').ok);

  /* ---------------- 2. Missing / Offline Ollama Behavior ---------------- */
  // Probing a dead Ollama port returns clean reachable: false without throwing
  const deadPortProbe = await H.probeOllama('http://127.0.0.1:1');
  check('ollama down: probe returns reachable: false', deadPortProbe.reachable === false && deadPortProbe.models.length === 0);

  const emptySummary = H.summarize([], { now: Date.now() });
  const vsDown = H.verdicts(emptySummary, { ollama: deadPortProbe, defaultModel: 'qwen3.5:4b' });
  check('ollama down: verdict is marked bad with actionable advice', vsDown.some(v => v.level === 'bad' && /not answering/i.test(v.text) && /Open the Ollama app/i.test(v.fix)));

  // llm.js listModels handles offline Ollama gracefully
  const llmNoOllama = createLLM({
    getConfig: () => ({ providers: [] }),
    saveConfig: () => {},
    OLLAMA: 'http://127.0.0.1:1',
    DEFAULT_MODEL: 'qwen3.5:4b'
  });
  const modelsStatus = await llmNoOllama.listModels();
  check('ollama down: listModels reports ollamaOnline: false without crashing', modelsStatus.ollamaOnline === false && Array.isArray(modelsStatus.models));

  // Sending a chat request when Ollama is down fails immediately with localDown flag and friendly message
  let downErr = null;
  try {
    await llmNoOllama.complete({ model: 'qwen3.5:4b', messages: [{ role: 'user', content: 'test' }], retryMs: 1 });
  } catch (e) {
    downErr = e;
  }
  check('ollama down: complete throws friendly unavailable error', downErr && /Local LLM unavailable — is Ollama running\?/i.test(downErr.message) && downErr.localDown === true);

  /* ---------------- 3. Missing / Broken Cloud API Providers ---------------- */
  // Unconfigured / removed provider
  let provErr = null;
  try {
    llmNoOllama.resolve('openai::gpt-4o');
  } catch (e) {
    provErr = e;
  }
  check('cloud provider missing: throws clear guidance to pick model in Settings', provErr && /isn't set up any more — pick another model in Settings/.test(provErr.message));

  // Friendly error masks any API key
  const maskedErr = createLLM.friendlyError(401, 'OpenAI', 'invalid key sk-1234567890abcdef', 'sk-1234567890abcdef');
  check('cloud error: 401 masks API key and explains rejection', /rejected the API key/.test(maskedErr.message) && !maskedErr.message.includes('sk-1234567890abcdef'));

  // Cloud provider network error in listModels records in errors map without crashing
  const llmBrokenCloud = createLLM({
    getConfig: () => ({ providers: [{ id: 'fakecloud', preset: 'openai', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-fake' }] }),
    saveConfig: () => {},
    OLLAMA: 'http://127.0.0.1:1',
    DEFAULT_MODEL: 'qwen3.5:4b'
  });
  const brokenList = await llmBrokenCloud.listModels();
  check('cloud down: provider error recorded in errors dict', brokenList.errors && typeof brokenList.errors.fakecloud === 'string');

  /* ---------------- 4. Missing / Offline Camera Libraries ---------------- */
  // In camera-page.js, loadScript rejects cleanly and cleans up script element
  const createdScripts = [];
  const fakeDoc = {
    createElement: tag => {
      const el = { tag, attrs: {}, remove() { el._removed = true; }, getContext: () => ({ drawImage: () => {} }) };
      createdScripts.push(el);
      return el;
    },
    head: {
      appendChild: el => {
        // simulate download network failure
        setTimeout(() => { if (el.onerror) el.onerror(new Error('Network error')); }, 0);
      }
    }
  };
  const cameraSrc = fs.readFileSync(root('camera-page.js'), 'utf8');
  const fakeCamera = new Function('document', 'CdnPins', 'window', 'navigator', 'location', cameraSrc + ';return Camera;')(
    fakeDoc, Pins, { document: fakeDoc }, { mediaDevices: {} }, { reload() {} }
  );

  let scriptErr = null;
  try {
    await fakeCamera.loadScript('https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js', 500);
  } catch (e) {
    scriptErr = e;
  }
  check('camera library offline: loadScript rejects cleanly on download failure', scriptErr && /could not be downloaded/.test(scriptErr.message));
  check('camera library offline: failed script element removed from document', createdScripts.length > 0 && createdScripts[0]._removed === true);

  // cropOnly fallback works pure-DOM/canvas without OpenCV
  const fakeCanvas = {
    width: 600,
    height: 400,
    getContext: () => ({
      drawImage: () => {}
    })
  };
  const corners = { tl: { x: 50, y: 50 }, tr: { x: 550, y: 50 }, br: { x: 550, y: 350 }, bl: { x: 50, y: 350 } };
  const cropped = fakeCamera.cropOnly(fakeCanvas, corners);
  check('camera fallback: cropOnly produces valid bounding crop without OpenCV', cropped && cropped.width === 500 && cropped.height === 300);

  // camError maps errors to plain user advice
  check('camError: NotAllowedError gives permission advice', /Click the camera icon in the address bar and allow it/.test(fakeCamera.camError({ name: 'NotAllowedError' })));
  check('camError: NotFoundError advises choosing photo file', /I could not find a camera on this computer/.test(fakeCamera.camError({ name: 'NotFoundError' })));
  check('camError: NotReadableError mentions camera is busy', /The camera is busy/.test(fakeCamera.camError({ name: 'NotReadableError' })));

  /* ---------------- 5. Script.js Status Messaging Check ---------------- */
  const scriptContent = fs.readFileSync(root('script.js'), 'utf8');
  check('script.js: updateLLMUI distinguishes cloud unreachable from ollama offline', scriptContent.includes('info.providerLabel + \' unreachable\''));
  check('script.js: turn failure reports cloud provider label when cloud model is selected', scriptContent.includes('isCloudModel(llm.model) ? \'I could not reach \' + modelInfo(llm.model).providerLabel'));

  console.log(`offline-fallbacks: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.log('CRASH', e);
  process.exitCode = 1;
});
