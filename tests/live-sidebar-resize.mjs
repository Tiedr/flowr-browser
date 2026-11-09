import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let server;
let socket;
let originalSettings;

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
}

async function waitFor(check, description, attempts = 50) {
  for (let index = 0; index < attempts; index += 1) {
    const value = await check();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out: ${description}`);
}

async function cleanup() {
  try { if (originalSettings) await socket?.eval(`window.electron?.ipcRenderer.invoke('update-settings',{siteApps:${JSON.stringify(originalSettings.siteApps || [])}})`); } catch {}
  try { socket?.close(); } catch {}
  if (server) await new Promise(resolve => server.close(resolve));
  if (child?.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}

(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Panel Fixture</title><style>body{font-family:sans-serif}#width{font-size:32px}</style><div id="width"></div><script>const show=()=>document.getElementById("width").textContent=innerWidth+"px";addEventListener("resize",show);show()</script>');
  });
  await new Promise(resolve => server.listen(4177, '127.0.0.1', resolve));
  child = spawn(path.resolve('release_pwa/win-unpacked/Flowr.exe'), ['--remote-debugging-port=9227'], { env: { ...process.env, FLOW_CHILD: '1' }, stdio: 'ignore' });

  const target = await waitFor(async () => {
    try {
      const items = await fetch('http://127.0.0.1:9227/json').then(response => response.json());
      return items.find(item => item.url.includes('/dist/index.html'));
    } catch { return null; }
  }, 'Flowr app chrome');
  socket = await Cdp.open(target);
  await waitFor(() => socket.eval('typeof window.electron !== "undefined"'), 'Flowr bridge');
  originalSettings = await socket.eval('window.electron.ipcRenderer.invoke("get-settings")');
  const fixture = { id: 'fixture-sidebar-app', name: 'Fixture Panel', url: 'http://127.0.0.1:4177/panel', standalone: false };
  const apps = [...(originalSettings.siteApps || []).filter(item => item.id !== fixture.id), fixture];
  await socket.eval(`window.electron.ipcRenderer.invoke('update-settings',{siteApps:${JSON.stringify(apps)}})`);
  await socket.eval('location.reload()');
  await waitFor(() => socket.eval('typeof window.electron !== "undefined" && document.readyState === "complete"'), 'reloaded app');
  await waitFor(() => socket.eval(`!!document.querySelector('[aria-label="Fixture Panel"]')`), 'sidebar shortcut');
  await socket.eval(`document.querySelector('[aria-label="Fixture Panel"]').click()`);

  const panelInfo = await waitFor(async () => {
    const info = await socket.eval(`(async()=>{const views=[...document.querySelectorAll('webview')];for(const view of views){try{if(view.getURL().includes('/panel')){const width=await view.executeJavaScript('innerWidth');return {width,elementWidth:view.getBoundingClientRect().width}}}catch{}}return null})()`);
    return info?.width === 430 ? info : null;
  }, 'initial 430px sidebar viewport');

  await socket.eval(`(()=>{const views=[...document.querySelectorAll('webview')];const view=views.find(item=>item.getURL().includes('/panel'));const host=view.parentNode;host.style.width='320px';host.parentNode.style.width='320px';window.dispatchEvent(new Event('resize'));return true})()`);
  const resized = await waitFor(async () => {
    const info = await socket.eval(`(async()=>{const views=[...document.querySelectorAll('webview')];const view=views.find(item=>item.getURL().includes('/panel'));if(!view)return null;return {width:await view.executeJavaScript('innerWidth'),elementWidth:view.getBoundingClientRect().width,hostWidth:view.parentNode.getBoundingClientRect().width}})()`);
    return info?.width === 320 && info.elementWidth === 320 && info.hostWidth === 320 ? info : null;
  }, 'resized 320px sidebar viewport');

  console.log(JSON.stringify({ initial: panelInfo, resized }, null, 2));
  console.log('Packaged sidebar resize live check passed.');
  await cleanup();
})().catch(async error => {
  console.error(error.stack || error);
  await cleanup();
  process.exit(1);
});
