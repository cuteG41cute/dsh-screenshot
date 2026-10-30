// Real-browser compatibility gate for static/lib/client.js.
//
// The 1.2.1 watchdog fix was written against WebKitGTK (Linux desktop); 1.3.1 adds the
// the exact shipped bundle into a real Chromium engine (Edge/Chrome headless,
// the engine the Windows/Web build actually runs on) over CDP and drives
// grabFrame() through every branch the fix touched:
//
//   1. happy path            -> Windows/Chromium resolves immediately, no retry
//   2. picker dismissed      -> NotAllowedError maps to null, no retry storm
//   3. OverconstrainedError  -> exactly one retry with the minimal constraints
//   4. hard failure          -> localized message, no hang
//   5. dead backend          -> watchdog fires, no retry
//   6. no getDisplayMedia    -> capability error, no crash
//
// A real MediaStream comes from canvas.captureStream(), so the whole capture
// pipeline (video element play -> videoWidth -> drawImage -> canvas) executes
// natively instead of being stubbed.
//
// Usage: node test/browser-compat.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(root, 'static', 'lib', 'client.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/microsoft-edge',
];
const BROWSER = process.env.DSH_COMPAT_BROWSER || CANDIDATES.find(existsSync);
if (!BROWSER) {
  console.error('FAIL: no Chromium-based browser found; set DSH_COMPAT_BROWSER');
  process.exit(1);
}

const source = readFileSync(BUNDLE, 'utf8');

// ── CDP plumbing ───────────────────────────────────────────────────────────
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws connect failed')); });
    const cdp = new Cdp(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && cdp.pending.has(m.id)) {
        const p = cdp.pending.get(m.id);
        cdp.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
    return r.result.value;
  }
}

async function freePort() {
  return await new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

// Runs one browser pass with a given bundle source and returns the engine label.
async function withPage(bundleSource, body) {
  const port = await freePort();
  const profile = join(tmpdir(), 'dsh-shot-compat-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(profile, { recursive: true });
  const proc = spawn(BROWSER, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
    '--allow-file-access-from-files', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 80; i++) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        if (targets.some((t) => t.type === 'page')) break;
      } catch { /* not up yet */ }
      await sleep(200);
    }
    const page = (targets || []).find((t) => t.type === 'page');
    if (!page) throw new Error('browser never exposed a page target');
    const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const version = await cdp.eval('navigator.userAgent');
    // Prelude: capture the plugin definition, then evaluate the real bundle.
    await cdp.eval(`window.__ModuleLoader__ = { load(def) { window.__def = def; } }; 1`);
    await cdp.eval(bundleSource + '\n;1');
    // Mount exactly like the harness does: factory(require) -> apply(ctx).
    await cdp.eval(`(() => {
      const reactStub = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
        useEffect: () => {},
      };
      const injected = [];
      const plugin = window.__def.factory((name) => {
        if (name === 'react') return reactStub;
        throw new Error('unexpected require: ' + name);
      });
      plugin.apply({ get: (name) => (name === 'slots' ? {
        inject(slot, factory) { injected.push({ slot, entry: factory() }); },
        register(options, component) { return { options, component }; },
      } : undefined) });
      window.__injected = injected.map((i) => ({ slot: i.slot, id: i.entry.options.id, order: i.entry.options.order,
        rendersButton: (() => { const tree = i.entry.component(); return tree && tree.type === 'button'
          && tree.props['data-dsh-screenshot'] === 'button' && typeof tree.props.onClick === 'function'; })() }));
      return 1;
    })()`);
    return await body(cdp, version);
  } finally {
    try { proc.kill(); } catch { /* already gone */ }
  }
}

// ── assertions ─────────────────────────────────────────────────────────────
const marks = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((detail) => { marks.push({ ok: true, name, detail }); })
    .catch((error) => { marks.push({ ok: false, name, detail: error.message }); });
}
function assert(cond, message) { if (!cond) throw new Error(message); }

// The scenario helpers are evaluated as strings inside the page.
const PRELUDE = `
  window.__calls = [];
  window.__realMediaDevices = navigator.mediaDevices;
  window.__stream = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#0a2'; g.fillRect(0, 0, w, h);
    return c.captureStream(30);
  };
  window.__setGDM = (fn) => Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true, value: { getDisplayMedia: fn },
  });
  window.__restoreGDM = () => Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true, value: window.__realMediaDevices,
  });
  window.__err = (name, message) => { const e = new DOMException(message || 'x', name); return e; };
  1;
`;

async function main() {
  // Probe version + mount contract + Windows happy path on the shipped bundle.
  const ua = await withPage(source, async (cdp, userAgent) => {
    await cdp.eval(PRELUDE);
    await check('bundle mounts and the probe reports 1.3.1', async () => {
      const probe = await cdp.eval(`({ version: window.__dshScreenshot.version,
        keys: Object.keys(window.__dshScreenshot).sort().join(','),
        injected: window.__injected })`);
      assert(probe.version === '1.3.1', 'probe version is ' + probe.version);
      assert(probe.keys === 'attachFile,captureRegion,editImage,grabFrame,pickRegion,version',
        'probe surface changed: ' + probe.keys);
      assert(probe.injected.length === 1, 'expected one slot injection');
      assert(probe.injected[0].id === 'dsh-screenshot', 'wrong entry id');
      assert(probe.injected[0].rendersButton === true, 'button did not render');
      return 'version=' + probe.version + ' slot=' + probe.injected[0].slot;
    });

    await check('Chromium happy path captures a real stream in well under 1s', async () => {
      const r = await cdp.eval(`(async () => {
        window.__calls = [];
        window.__setGDM(async (constraints) => { window.__calls.push(constraints); return window.__stream(640, 480); });
        const t0 = performance.now();
        const frame = await window.__dshScreenshot.grabFrame();
        window.__restoreGDM();
        return { ms: performance.now() - t0, w: frame && frame.width, h: frame && frame.height,
          type: frame && frame.tagName, calls: window.__calls.length, first: window.__calls[0] };
      })()`);
      assert(r.w === 640 && r.h === 480, 'frame size is ' + r.w + 'x' + r.h);
      assert(r.type === 'CANVAS', 'frame is a ' + r.type);
      assert(r.calls === 1, 'happy path made ' + r.calls + ' getDisplayMedia calls (retry regression)');
      assert(r.first.selfBrowserSurface === 'exclude', 'original constraints changed: ' + JSON.stringify(r.first));
      assert(r.ms < 1000, 'happy path took ' + Math.round(r.ms) + 'ms (watchdog latency regression)');
      await cdp.eval('window.__restoreGDM(); 1');
      return Math.round(r.ms) + 'ms 640x480, 1 call';
    });

    await check('dismissed picker returns null without retrying', async () => {
      const r = await cdp.eval(`(async () => {
        window.__calls = [];
        window.__setGDM(async (c) => { window.__calls.push(c); throw window.__err('NotAllowedError'); });
        const t0 = performance.now();
        const frame = await window.__dshScreenshot.grabFrame();
        window.__restoreGDM();
        return { frame: frame === null ? 'null' : typeof frame, ms: performance.now() - t0, calls: window.__calls.length };
      })()`);
      assert(r.frame === 'null', 'expected null, got ' + r.frame);
      assert(r.calls === 1, 'cancel caused ' + r.calls + ' attempts');
      assert(r.ms < 1000, 'cancel took ' + Math.round(r.ms) + 'ms');
      return 'null in ' + Math.round(r.ms) + 'ms';
    });

    await check('OverconstrainedError retries once with minimal constraints', async () => {
      const r = await cdp.eval(`(async () => {
        window.__calls = [];
        window.__setGDM(async (c) => {
          window.__calls.push(c);
          if (window.__calls.length === 1) throw window.__err('OverconstrainedError', 'Invalid constraint');
          return window.__stream(320, 200);
        });
        const frame = await window.__dshScreenshot.grabFrame();
        window.__restoreGDM();
        return { w: frame && frame.width, calls: window.__calls };
      })()`);
      assert(r.calls.length === 2, 'expected 2 attempts, got ' + r.calls.length);
      assert(r.calls[1].video === true && r.calls[1].audio === false
        && Object.keys(r.calls[1]).length === 2, 'retry constraints are ' + JSON.stringify(r.calls[1]));
      assert(r.w === 320, 'retry frame width is ' + r.w);
      return 'retry=' + JSON.stringify(r.calls[1]);
    });

    await check('hard failure reports a localized message and stops', async () => {
      const r = await cdp.eval(`(async () => {
        window.__calls = [];
        window.__setGDM(async (c) => { window.__calls.push(c); throw window.__err('NotFoundError'); });
        let message = null;
        try { await window.__dshScreenshot.grabFrame(); } catch (e) { message = e.message; }
        window.__restoreGDM();
        return { message, calls: window.__calls.length };
      })()`);
      assert(r.message !== null, 'grabFrame resolved instead of throwing');
      assert(r.message.indexOf('未找到可捕获的屏幕/窗口源') === 0, 'message is ' + r.message);
      assert(r.calls === 2, 'hard failure made ' + r.calls + ' attempts');
      return r.message.slice(0, 24) + '… (2 attempts)';
    });

    await check('missing getDisplayMedia is a capability error, not a crash', async () => {
      const r = await cdp.eval(`(async () => {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
        let message = null;
        try { await window.__dshScreenshot.grabFrame(); } catch (e) { message = e.message; }
        window.__restoreGDM();
        return { message };
      })()`);
      assert(r.message !== null && r.message.indexOf('当前环境不支持屏幕捕获') === 0, 'message is ' + r.message);
      return r.message;
    });

    await check('native bridge: host reply becomes a canvas, no getDisplayMedia call', async () => {
      const r = await cdp.eval(`(async () => {
        window.__calls = [];
        window.__nativeMsgs = [];
        // 造一个桌面壳的桥：postMessage 把消息留住，随后由测试替宿主回话
        window.chrome = { webview: { postMessage: (s) => { window.__nativeMsgs.push(JSON.parse(s)); } } };
        const src = document.createElement('canvas');
        src.width = 640; src.height = 480;
        const g = src.getContext('2d'); g.fillStyle = '#2a7'; g.fillRect(0, 0, 640, 480);
        const dataUrl = src.toDataURL('image/png');
        window.__setGDM(async (c) => { window.__calls.push(c); return window.__stream(10, 10); });
        const pending = window.__dshScreenshot.grabFrame();
        // 等桥的消息到达，按 id 回话（正是宿主的做法）
        let msg = null;
        for (let i = 0; i < 100; i++) {
          if (window.__nativeMsgs.length > 0) { msg = window.__nativeMsgs[0]; break; }
          await new Promise((res) => setTimeout(res, 20));
        }
        if (msg === null) return { error: 'page never posted to the bridge' };
        window.__dshShotReply(msg.id, { ok: true, dataUrl: dataUrl });
        const frame = await pending;
        window.__restoreGDM();
        delete window.chrome;
        return { type: msg.type, w: frame && frame.width, h: frame && frame.height,
                 gdm: window.__calls.length };
      })()`);
      assert(r.error === undefined, r.error || 'bridge test failed');
      assert(r.type === 'dsh-screenshot', 'unexpected message type: ' + r.type);
      assert(r.w === 640 && r.h === 480, 'native frame is ' + r.w + 'x' + r.h);
      assert(r.gdm === 0, 'native path still called getDisplayMedia (' + r.gdm + 'x)');
      return 'type=' + r.type + ' ' + r.w + 'x' + r.h + ', 0 getDisplayMedia calls';
    });

    await check('native bridge failure falls back to getDisplayMedia', async () => {
      const r = await cdp.eval(`(async () => {
        window.__calls = [];
        window.__nativeMsgs = [];
        window.chrome = { webview: { postMessage: (s) => { window.__nativeMsgs.push(JSON.parse(s)); } } };
        window.__setGDM(async (c) => { window.__calls.push(c); return window.__stream(320, 200); });
        const pending = window.__dshScreenshot.grabFrame();
        let msg = null;
        for (let i = 0; i < 100; i++) {
          if (window.__nativeMsgs.length > 0) { msg = window.__nativeMsgs[0]; break; }
          await new Promise((res) => setTimeout(res, 20));
        }
        if (msg === null) return { error: 'page never posted to the bridge' };
        window.__dshShotReply(msg.id, { ok: false, error: 'portal 不可用' });
        const frame = await pending;
        window.__restoreGDM();
        delete window.chrome;
        const toast = document.querySelector('[data-dsh-screenshot-toast]');
        return { w: frame && frame.width, gdm: window.__calls.length,
                 toast: toast ? toast.textContent : '' };
      })()`);
      assert(r.error === undefined, r.error || 'fallback test failed');
      assert(r.gdm === 1, 'expected one getDisplayMedia attempt, got ' + r.gdm);
      assert(r.w === 320, 'fallback frame width is ' + r.w);
      assert(r.toast.indexOf('原生截屏通道不可用') === 0, 'toast is ' + JSON.stringify(r.toast));
      return 'fallback ' + r.w + 'px after 1 getDisplayMedia call';
    });

    return userAgent;
  });

  // Watchdog pass: shrink the budget so the dead-backend branch can be observed.
  const patched = source.replace('const CAPTURE_WATCHDOG_MS = 45000;', 'const CAPTURE_WATCHDOG_MS = 700;');
  if (patched === source) throw new Error('watchdog constant not found; the test would silently skip the timeout branch');
  await withPage(patched, async (cdp) => {
    await cdp.eval(PRELUDE);
    await check('dead backend trips the watchdog once and does not retry', async () => {
      const r = await cdp.eval(`(async () => {
        window.__calls = [];
        window.__setGDM((c) => { window.__calls.push(c); return new Promise(() => {}); });
        const t0 = performance.now();
        let message = null;
        try { await window.__dshScreenshot.grabFrame(); } catch (e) { message = e.message; }
        window.__restoreGDM();
        return { message, ms: performance.now() - t0, calls: window.__calls.length };
      })()`);
      assert(r.message !== null, 'watchdog never fired (grabFrame still pending)');
      assert(r.message.indexOf('屏幕捕获请求超时') === 0, 'message is ' + String(r.message).slice(0, 40));
      assert(r.calls === 1, 'timeout retried: ' + r.calls + ' attempts');
      assert(r.ms < 3000, 'watchdog fired after ' + Math.round(r.ms) + 'ms');
      return Math.round(r.ms) + 'ms, 1 attempt';
    });
    return 0;
  });

  const failed = marks.filter((m) => !m.ok);
  for (const m of marks) {
    console.log((m.ok ? 'PASS ' : 'FAIL ') + m.name + (m.detail !== undefined ? '  [' + m.detail + ']' : ''));
  }
  console.log('\nengine: ' + ua);
  console.log('bundle: ' + source.length + ' bytes  ' + BUNDLE);
  console.log(marks.length - failed.length + '/' + marks.length + ' PASS');
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('FAIL: ' + (error && error.stack ? error.stack : error));
  process.exit(1);
});
