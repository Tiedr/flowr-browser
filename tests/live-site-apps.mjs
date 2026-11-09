import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let server;
let mainSocket;
let appSocket;

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    };
  }
  static async open(target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    return new Cdp(ws);
  }
  call(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  close() { this.ws.close(); }
}

async function waitFor(check, description, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    const value = await check();
    if (value) return value;
    await delay(300);
  }
  throw new Error(`Timed out: ${description}`);
}

async function cleanup() {
  try { await mainSocket?.eval(`window.electron?.ipcRenderer.invoke('set-site-permission',{origin:'http://127.0.0.1:4176',permission:'geolocation',decision:'reset'})`); } catch {}
  mainSocket?.close();
  appSocket?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (child?.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}

(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>Fixture App</title><h1>Fixture App</h1><p>${req.url}</p>`);
  });
  await new Promise(resolve => server.listen(4176, '127.0.0.1', resolve));
  child = spawn(path.resolve('release_pwa/win-unpacked/Flowr.exe'), ['--remote-debugging-port=9226'], {
    env: { ...process.env, FLOW_CHILD: '1' }, stdio: 'ignore'
  });

  const targets = await waitFor(async () => {
    try {
      const items = await fetch('http://127.0.0.1:9226/json').then(response => response.json());
      return items.some(item => item.url.includes('/dist/index.html')) ? items : null;
    } catch { return null; }
  }, 'Flowr app chrome');
  const mainTarget = targets.find(item => item.url.includes('/dist/index.html'));
  mainSocket = await Cdp.open(mainTarget);
  await waitFor(() => mainSocket.eval('typeof window.electron !== "undefined"'), 'Flowr bridge');

  const appItem = { id: 'fixture-app', name: 'Fixture App', url: 'http://127.0.0.1:4176/app/home', scope: 'http://127.0.0.1:4176/app/', display: 'standalone', standalone: true };
  const launch = await mainSocket.eval(`window.electron.ipcRenderer.invoke('open-site-app',${JSON.stringify(appItem)})`);
  if (!launch?.ok) throw new Error(`Launch failed: ${JSON.stringify(launch)}`);

  const appTarget = await waitFor(async () => {
    const items = await fetch('http://127.0.0.1:9226/json').then(response => response.json());
    return items.find(item => item.id !== mainTarget.id && item.type === 'page' && (item.url === 'about:blank' || item.url.includes('/app/home')));
  }, 'standalone app window');
  appSocket = await Cdp.open(appTarget);
  const href = await waitFor(async () => {
    const value = await appSocket.eval('location.href');
    return value.includes('/app/home') ? value : null;
  }, 'standalone app navigation');

  await mainSocket.eval(`window.electron.ipcRenderer.invoke('set-site-permission',{origin:'http://127.0.0.1:4176',permission:'geolocation',decision:'allow'})`);
  const allowed = await waitFor(async () => {
    const state = await appSocket.eval(`navigator.permissions.query({name:'geolocation'}).then(result=>result.state)`);
    return state === 'granted' ? state : null;
  }, 'allowed permission');
  await mainSocket.eval(`window.electron.ipcRenderer.invoke('set-site-permission',{origin:'http://127.0.0.1:4176',permission:'geolocation',decision:'block'})`);
  const blocked = await waitFor(async () => {
    const state = await appSocket.eval(`navigator.permissions.query({name:'geolocation'}).then(result=>result.state)`);
    return state === 'denied' ? state : null;
  }, 'blocked permission');

  await appSocket.eval(`location.href='http://127.0.0.1:4176/outside'`);
  await waitFor(async () => {
    const urls = await mainSocket.eval(`[...document.querySelectorAll('webview')].map(view=>{try{return view.getURL()}catch{return ''}})`);
    return urls.some(url => url.includes('/outside')) ? urls : null;
  }, 'external link in a browser tab');
  const appAfter = await appSocket.eval('location.href');
  const focused = await mainSocket.eval(`window.electron.ipcRenderer.invoke('open-site-app',${JSON.stringify(appItem)})`);
  const outcome = {
    standaloneUrl: href,
    permissionAllowed: allowed,
    permissionBlocked: blocked,
    appStayedInScope: appAfter.includes('/app/home'),
    externalOpenedInBrowser: true,
    reopenFocused: focused?.focused === true
  };
  console.log(JSON.stringify(outcome, null, 2));
  if (!outcome.appStayedInScope || !outcome.reopenFocused) throw new Error('Standalone scope/focus assertion failed.');
  console.log('Packaged standalone app and permission live checks passed.');
  await cleanup();
})().catch(async error => {
  console.error(error.stack || error);
  await cleanup();
  process.exit(1);
});
