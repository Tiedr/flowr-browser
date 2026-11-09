import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let socket;

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
    await delay(300);
  }
  throw new Error(`Timed out: ${description}`);
}

async function cleanup() {
  try { socket?.close(); } catch {}
  if (child?.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}

(async () => {
  child = spawn(path.resolve('release_120/win-unpacked/Flowr.exe'), ['--remote-debugging-port=9229'], { env: { ...process.env, FLOW_CHILD: '1' }, stdio: 'ignore' });
  const target = await waitFor(async () => {
    try {
      const items = await fetch('http://127.0.0.1:9229/json').then(response => response.json());
      return items.find(item => item.url.includes('/dist/index.html'));
    } catch { return null; }
  }, 'Flowr app chrome');
  socket = await Cdp.open(target);
  await waitFor(() => socket.eval('typeof window.electron !== "undefined"'), 'Flowr bridge');

  async function inspect(url, id, partition = 'persist:flow-main') {
    await socket.eval(`(()=>{const old=document.getElementById(${JSON.stringify(id)});if(old)old.remove();const view=document.createElement('webview');view.id=${JSON.stringify(id)};${partition ? `view.setAttribute('partition','${partition}');` : ''}view.style.cssText='width:900px;height:650px';document.body.appendChild(view);view.setAttribute('src',${JSON.stringify(url)});return true})()`);
    await waitFor(() => socket.eval(`(async()=>{const view=document.getElementById(${JSON.stringify(id)});try{const ready=await view.executeJavaScript('document.readyState === "complete" && !!document.body');return ready}catch{return false}})()`), 'page load');
    await delay(1200);
    const raw = await socket.eval(`(async()=>{const view=document.getElementById(${JSON.stringify(id)});return await view.executeJavaScript('(async()=>JSON.stringify({ua:navigator.userAgent,vendor:navigator.vendor,title:document.title,text:document.body.innerText.slice(0,1400),high:navigator.userAgentData?await navigator.userAgentData.getHighEntropyValues(["uaFullVersion","fullVersionList","platform"]):null}))()')})()`);
    return JSON.parse(raw);
  }

  const google = await inspect('https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn&flowEntry=ServiceLogin', 'google-oauth-check');
  const unsupported = /this browser or app may not be secure|try using a different browser/i.test(google.text);
  const compatible = /Chrome\/\d+\.\d+\.\d+\.\d+/.test(google.ua) && !/Flowr|Electron|flow-browser/i.test(google.ua);
  const store = await inspect('https://flowr.tieddr.com/store/', 'store-identity-check');
  const storePreserved = /Flowr\/\d+\.\d+\.\d+/.test(store.ua);
  const defaultStore = await inspect('https://flowr.tieddr.com/store/', 'default-store-identity-check', '');
  const defaultSessionSafe = !/Electron|flow-browser/i.test(defaultStore.ua) && /Flowr\/\d+\.\d+\.\d+/.test(defaultStore.ua);
  const outcome = {
    googleUserAgent: google.ua,
    googleVendor: google.vendor,
    googleTitle: google.title,
    fullVersionList: google.high?.fullVersionList,
    unsupportedMessagePresent: unsupported,
    compatibleOAuthIdentity: compatible,
    storeIdentityPreserved: storePreserved,
    defaultSessionSafe
  };
  console.log(JSON.stringify(outcome, null, 2));
  if (unsupported || !compatible || !storePreserved || !defaultSessionSafe) throw new Error(`OAuth identity check failed. Google page: ${google.text.slice(0, 500)}`);
  console.log('Live Google sign-in and Flowr Store identity checks passed.');
  await cleanup();
})().catch(async error => {
  console.error(error.stack || error);
  await cleanup();
  process.exit(1);
});
