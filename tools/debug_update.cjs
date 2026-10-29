/* Диагностика проверки обновлений: сеть, CORS, onLine, тосты */
'use strict';
const { spawn, execSync } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9800 + Math.floor(Math.random() * 150);
const PROFILE = path.join(os.tmpdir(), 'al-upd-' + Date.now());
const APP = process.env.APP_URL || 'http://127.0.0.1:8787/';

const get = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return 'ИСКЛЮЧЕНИЕ: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

(async () => {
  console.log('страница: ' + APP);
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, APP
  ], { stdio: 'ignore', detached: true });
  child.unref();

  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list'));
      page = list.find(t => t.type === 'page');
      if (page) break;
    } catch (e) { }
    await sleep(300);
  }
  if (!page) throw new Error('нет вкладки');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await sleep(2500);

  console.log('onLine      :', await cdp.eval('navigator.onLine'));
  console.log('origin      :', await cdp.eval('location.origin'));
  console.log('Update есть :', await cdp.eval('typeof Update !== "undefined"'));
  console.log('версия      :', await cdp.eval('typeof Update !== "undefined" ? Update.current : "нет"'));
  console.log('кнопка есть :', await cdp.eval('!!document.querySelector("#btnCheckUpdate")'));

  console.log('\n--- прямой fetch ---');
  console.log(await cdp.eval(`(async () => {
    try {
      const r = await fetch('https://api.github.com/repos/luckyvoron-tech/arendalog/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      return 'HTTP ' + r.status + ', ' + (await r.text()).length + ' символов';
    } catch (e) { return 'ОШИБКА: ' + e.message; }
  })()`));

  console.log('\n--- Update.check(false) ---');
  console.log(await cdp.eval(`(async () => {
    const toasts = [];
    const orig = UI.toast;
    UI.toast = function (m, ms) { toasts.push(String(m)); return orig.call(UI, m, ms); };
    let result;
    try { result = await Update.check(false); } catch (e) { result = 'исключение: ' + e.message; }
    UI.toast = orig;
    return JSON.stringify({ result: result ? { version: result.version, url: result.url } : null, toasts });
  })()`));

  console.log('\n--- нажатие на кнопку ---');
  console.log(await cdp.eval(`(async () => {
    document.querySelector('#btnCheckUpdate').click();
    await new Promise(r => setTimeout(r, 5000));
    const body = document.querySelector('#modalBody');
    const open = document.querySelector('#modal').className.indexOf('hide') < 0;
    return JSON.stringify({ open, text: body ? body.innerText.replace(/\\s+/g, ' ').slice(0, 220) : 'нет' });
  })()`));

  console.log('\n--- диагностика связи ---');
  console.log(await cdp.eval(`(async () => {
    document.querySelector('#modalClose').click();
    document.querySelector('#btnDiag').click();
    await new Promise(r => setTimeout(r, 9000));
    const body = document.querySelector('#modalBody');
    return JSON.stringify({ text: body ? body.innerText.replace(/\\s+/g, ' ').slice(0, 300) : 'нет' });
  })()`));

  try { ws.close(); } catch (e) { }
  try { execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('УПАЛО: ' + e.message); process.exit(2); });
