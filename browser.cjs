// Minimal CDP browser driver: no npm dependencies, uses installed Chrome.
// Usage:
//   node browser.cjs shot <url> <out.png> [width] [height]
//   node browser.cjs eval <url> <js-expression>
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = path.join(__dirname, '.browser-profile');
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 2000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function launch() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const child = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--disable-features=Translate,MediaRouter',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { const v = await httpJson('/json/version'); if (v.webSocketDebuggerUrl) return { child, wsUrl: v.webSocketDebuggerUrl }; } catch {}
  }
  throw new Error('chrome did not expose CDP');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });
    const cdp = new Cdp(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
      } else if (msg.method) {
        cdp.events.push(msg);
      }
    };
    return cdp;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async waitFor(method, sessionId, timeout = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const i = this.events.findIndex((e) => e.method === method && (!sessionId || e.sessionId === sessionId));
      if (i >= 0) return this.events.splice(i, 1)[0];
      await sleep(50);
    }
    return null;
  }
}

async function openPage(cdp, url, width, height) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await cdp.waitFor('Page.loadEventFired', sessionId, 20000);
  await sleep(600); // settle layout/paint
  return { targetId, sessionId };
}

(async () => {
  const [mode, url, arg, w, h] = process.argv.slice(2);
  if (!mode || !url) { console.error('usage: shot|eval <url> <out.png|js> [w] [h]'); process.exit(2); }
  const width = Number(w) || 1440;
  const height = Number(h) || 900;
  const { child, wsUrl } = await launch();
  let cdp;
  try {
    cdp = await Cdp.connect(wsUrl);
    const { sessionId, targetId } = await openPage(cdp, url, width, height);

    if (mode === 'shot') {
      const out = path.resolve(arg);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      fs.writeFileSync(out, Buffer.from(data, 'base64'));
      const title = await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, sessionId);
      console.log(JSON.stringify({ ok: true, file: out, bytes: fs.statSync(out).size, title: title.result?.value ?? '' }));
    } else {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(async () => { ${arg} })()`,
        awaitPromise: true, returnByValue: true,
      }, sessionId);
      console.log(JSON.stringify({ ok: true, value: r.result?.value ?? null, exception: r.exceptionDetails?.text ?? null }, null, 2));
    }
    await cdp.send('Target.closeTarget', { targetId });
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e && e.message) }));
  } finally {
    try { cdp && cdp.ws.close(); } catch {}
    child.kill();
  }
})();
