/* Сквозной тест АрендаЛог в headless Chrome через CDP: создание события и проверка цепочки */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = path.join(os.tmpdir(), 'alapp', 'index.html');
const URL_APP = 'file:///' + APP.replace(/\\/g, '/');
const PORT = 9400 + Math.floor(Math.random() * 400);
const PROFILE = path.join(os.tmpdir(), 'al-cdp-' + Date.now());

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForPort(timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { return JSON.parse(await get(`http://127.0.0.1:${PORT}/json/version`)); }
    catch (e) { await sleep(300); }
  }
  throw new Error('Chrome не поднял порт ' + PORT);
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async eval(expr, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, awaitPromise, returnByValue: true, userGesture: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
    return r.result.value;
  }
}

(async () => {
  console.log('приложение: ' + URL_APP);
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=420,900', URL_APP
  ], { stdio: 'ignore', detached: true });
  child.unref();

  const ver = await waitForPort();
  console.log('Chrome: ' + ver['Browser']);

  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`));
      page = list.find(t => t.type === 'page' && t.url.indexOf('index.html') >= 0)
          || list.find(t => t.type === 'page');
      if (page) break;
    } catch (e) { /* ещё не готово */ }
    await sleep(400);
  }
  if (!page) throw new Error('нет вкладки');
  console.log('вкладка: ' + page.url);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await sleep(2500);

  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
  };

  console.log('\n[1] Загрузка');
  const booted = await cdp.eval('typeof AL !== "undefined" && typeof UI !== "undefined"');
  check('ядро и интерфейс загружены', booted === true);
  const noError = await cdp.eval('!document.body.innerHTML.includes("Ошибка запуска")');
  check('нет экрана ошибки', noError === true);
  const tabs = await cdp.eval('document.querySelectorAll(".tab").length');
  check('навигация: 5 вкладок', tabs === 5, tabs);

  // первый запуск: условия использования
  let termsShown = false;
  for (let i = 0; i < 24; i++) {
    termsShown = await cdp.eval('!!document.querySelector("#tAccept")');
    if (termsShown) break;
    await sleep(250);
  }
  check('при первом запуске показаны условия', termsShown === true);
  await cdp.eval('(() => { const b = document.querySelector("#tAccept"); if (b) b.click(); return true; })()');
  await sleep(500);
  const termsGone = await cdp.eval('!document.querySelector("#modal").classList.contains("open")');
  check('условия принимаются и окно закрывается', termsGone === true);
  const accepted = await cdp.eval('AL.DB.getSet("termsAccepted", 0).then(Boolean)');
  check('факт принятия сохранён', accepted === true);

  console.log('\n[2] Ключ и цепочка');
  const key = await cdp.eval('(async()=>{const k=await AL.Crypto.ensureKeys();return k.pubHex.slice(0,12)})()');
  check('ключ подписи создан', typeof key === 'string' && key.length === 12, key);

  console.log('\n[3] Создание события через интерфейс');
  await cdp.eval('document.querySelector("#fabAdd").click()');
  await sleep(400);
  const modalOpen = await cdp.eval('document.querySelector("#modal").classList.contains("open")');
  check('форма открылась', modalOpen === true);
  await cdp.eval(`(() => {
    const set = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const ok1 = set('#eTitle', 'Течь под мойкой');
    const ok2 = set('#eNote', 'Обнаружено утром, вода на полу');
    const ok3 = set('#eAmount', '0');
    const ok4 = set('#eRoom', 'Кухня');
    return ok1 && ok2 && ok3 && ok4;
  })()`);
  await sleep(200);
  await cdp.eval('document.querySelector("#eSave").click()');
  await sleep(2500);

  const st = await cdp.eval('JSON.stringify({n:UI.state.events.length, t:UI.state.events[0] && UI.state.events[0].title, h:UI.state.events[0] && UI.state.events[0].hash, s:UI.state.events[0] && !!UI.state.events[0].sig})');
  const parsed = JSON.parse(st);
  check('событие сохранено', parsed.n === 1, st);
  check('заголовок записан', parsed.t === 'Течь под мойкой', parsed.t);
  check('хеш посчитан (64 hex)', /^[0-9a-f]{64}$/.test(parsed.h || ''), (parsed.h || '').slice(0, 16));
  check('подпись есть', parsed.s === true);

  console.log('\n[4] Целостность и отображение');
  const chain = await cdp.eval('(async()=>{const r=await UI.verifyChain();return JSON.stringify(r)})()');
  const chainObj = JSON.parse(chain);
  check('цепочка проверяется', chainObj.ok === true, chain);
  const cards = await cdp.eval('document.querySelectorAll(".ev").length');
  check('карточка в журнале отрисована', cards === 1, cards);
  const integrity = await cdp.eval('document.querySelector("#integrityBox").className');
  check('индикатор целостности активен', integrity.indexOf('integrity') === 0 && integrity.indexOf('hide') < 0, integrity);

  console.log('\n[5] Приёмка');
  await cdp.eval('UI.showTab("handover")');
  await sleep(300);
  await cdp.eval('document.querySelector("[data-hv=\\"accept\\"]").click()');
  await sleep(400);
  const hvTitle = await cdp.eval('document.querySelector("#modalTitle").textContent');
  check('открылась приёмка', hvTitle.indexOf('Приёмка') >= 0, hvTitle);
  const rooms = await cdp.eval('document.querySelectorAll(".room").length');
  check('комнаты в чек-листе', rooms >= 7, rooms);
  await cdp.eval('document.querySelector("#hvSave").click()');
  await sleep(2500);
  const hv = await cdp.eval('JSON.stringify({h:UI.state.handovers.length, e:UI.state.events.length})');
  const hvObj = JSON.parse(hv);
  check('акт приёмки подписан', hvObj.h === 1, hv);
  check('приёмка попала в журнал событием', hvObj.e === 2, hv);

  console.log('\n[6] Отчёт');
  await cdp.eval('UI.showTab("report")');
  await sleep(600);
  await cdp.eval('document.querySelector("#btnReport").click()');
  await sleep(800);
  const hasReport = await cdp.eval('!!document.querySelector("#printArea") && document.querySelector("#printArea").innerHTML.length > 500');
  check('отчёт сформирован', hasReport === true);
  const reportText = await cdp.eval('document.querySelector("#printArea").textContent');
  check('в отчёте есть заголовок', /Журнал аренды/.test(reportText), reportText.slice(0, 40));

  console.log('\n[7] Чек с контрагентом');
  await cdp.eval('UI.showTab("home")');
  await sleep(300);
  await cdp.eval('document.querySelector("#fabAdd").click()');
  await sleep(400);
  const typeChips = await cdp.eval('document.querySelectorAll("#typeChips .chip").length');
  check('в форме есть тип «Чек» и другие', typeChips >= 7, typeChips);
  await cdp.eval(`(() => {
    const chip = Array.from(document.querySelectorAll('#typeChips .chip')).find(c => c.dataset.t === 'receipt');
    if (chip) chip.click();
    const set = (sel, val) => { const el = document.querySelector(sel); if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('#eTitle', 'Чек на краску');
    set('#eAmount', '3500');
    set('#eCounterparty', 'Магазин «Строй»');
    return !!chip;
  })()`);
  await sleep(200);
  await cdp.eval('document.querySelector("#eSave").click()');
  await sleep(2500);
  const rc = await cdp.eval('JSON.stringify({n:UI.state.events.length, type:UI.state.events[UI.state.events.length-1].type, cp:UI.state.events[UI.state.events.length-1].meta && UI.state.events[UI.state.events.length-1].meta.counterparty})');
  const rcObj = JSON.parse(rc);
  check('чек сохранён', rcObj.type === 'receipt', rc);
  check('контрагент записан', rcObj.cp === 'Магазин «Строй»', rcObj.cp);
  const chain2 = JSON.parse(await cdp.eval('(async()=>JSON.stringify(await UI.verifyChain()))()'));
  check('цепочка цела после чека', chain2.ok === true, JSON.stringify(chain2));

  console.log('\n[8] Верификатор в приложении');
  await cdp.eval('UI.showTab("report")');
  await sleep(400);
  await cdp.eval('document.querySelector("#btnVerify").click()');
  await sleep(700);
  const verifierOk = await cdp.eval('!!document.querySelector("#modalBody iframe") && document.querySelector("#modalBody iframe").src.indexOf("verify.html") >= 0');
  check('верификатор открывается', verifierOk === true);
  await cdp.eval('document.querySelector("#modalClose").click()');

  console.log('\n[9] Экспорт пакета и проверка верификатором');
  const names = JSON.parse(await cdp.eval('(async () => { const p = await UI.buildEvidencePackage(); return JSON.stringify(p.manifest.files.map(f => f.name)); })()'));
  check('в пакете есть отчёт', names.includes('report.html'), names.join(','));
  check('в пакете есть журнал', names.includes('journal.json'));
  check('в пакете есть README', names.includes('README.txt'));

  const pkgB64 = await cdp.eval(`(async () => {
    const p = await UI.buildEvidencePackage();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(p.blob);
    });
  })()`);
  check('пакет собран в архив', typeof pkgB64 === 'string' && pkgB64.length > 2000, (pkgB64 || '').length);

  const verifyUrl = page.url.replace(/index\.html.*$/, 'verify.html');
  await cdp.send('Page.navigate', { url: verifyUrl });
  await sleep(2200);
  const feed = `(async () => {
    const bin = atob(${JSON.stringify(pkgB64)});
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const f = new File([arr], 'real.zip', { type: 'application/zip' });
    await handleFile(f);
    return document.querySelector('#result').innerText;
  })()`;
  const verdict = await cdp.eval(feed);
  check('верификатор: пакет подлинный', /Пакет подлинный и не изменён/.test(verdict), verdict.slice(0, 200));
  check('верификатор: события сверены', /Событий проверено\s*3 из 3/.test(verdict.replace(/\n/g, ' ')), verdict.replace(/\n/g, ' ').slice(0, 160));

  console.log('\n[10] Зоны и проживающие');
  await cdp.send('Page.navigate', { url: page.url });
  await sleep(2800);
  await cdp.eval('window.confirm = () => true');
  await cdp.eval('UI.showTab("object")');
  await sleep(500);
  const zones0 = await cdp.eval('document.querySelectorAll("#zonesList .kv").length');
  check('зоны по умолчанию отрисованы', zones0 >= 8, zones0);

  await cdp.eval('document.querySelector("#btnAddZone").click()');
  await sleep(400);
  await cdp.eval(`(() => {
    const set = (s, v) => { const el = document.querySelector(s); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('#zName', 'Мангальная зона');
    set('#zNote', 'во дворе, под навесом');
    set('#zItems', 'Мангал\\nСтол и стулья\\nОсвещение\\nНастил');
    document.querySelector('#zSave').click();
    return true;
  })()`);
  await sleep(700);
  const zones1 = await cdp.eval('document.querySelectorAll("#zonesList .kv").length');
  check('нетиповая зона добавлена', zones1 === zones0 + 1, zones1);
  const zoneData = await cdp.eval('JSON.stringify(UI.state.journal.zones.filter(z => z.name === "Мангальная зона")[0])');
  const zd = JSON.parse(zoneData);
  check('у зоны есть описание', zd.note === 'во дворе, под навесом', zd.note);
  check('у зоны 4 пункта', zd.items.length === 4, zd.items.length);

  await cdp.eval('document.querySelector("#btnAddPerson").click()');
  await sleep(400);
  await cdp.eval(`(() => {
    const set = (s, v) => { const el = document.querySelector(s); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('#pName', 'Иванова Мария');
    const sel = document.querySelector('#pRole'); sel.value = 'арендатор'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#pSave').click();
    return true;
  })()`);
  await sleep(600);
  const people = await cdp.eval('document.querySelectorAll("#peopleList .kv").length');
  check('проживающий добавлен', people === 1, people);

  console.log('\n[11] Приёмка использует мои зоны');
  await cdp.eval('UI.showTab("handover")');
  await sleep(400);
  await cdp.eval('document.querySelector("[data-hv=\\"accept\\"]").click()');
  await sleep(700);
  const roomsCustom = await cdp.eval('document.querySelectorAll(".room").length');
  check('в чек-листе 9 зон (8 + нетиповая)', roomsCustom === 9, roomsCustom);
  const hasMg = await cdp.eval('document.body.innerText.indexOf("Мангальная зона") >= 0');
  check('нетиповая зона в чек-листе', hasMg === true);
  const hasPeople = await cdp.eval('document.querySelector("#modalBody").innerText.indexOf("Иванова Мария") >= 0');
  check('проживающие показаны в приёмке', hasPeople === true);
  await cdp.eval('document.querySelector("#modalClose").click()');

  console.log('\n[12] Автообновление');
  const cmp = await cdp.eval(`JSON.stringify({
    newer: Update.isNewer('1.0.1','1.0.0'),
    same: Update.isNewer('1.0.0','1.0.0'),
    older: Update.isNewer('0.9.9','1.0.0'),
    vprefix: Update.isNewer('v2.0','1.0.0'),
    multi: Update.isNewer('1.2.10','1.2.9')
  })`);
  const c = JSON.parse(cmp);
  check('новая версия определяется', c.newer === true);
  check('та же версия не считается новой', c.same === false);
  check('старая версия не считается новой', c.older === false);
  check('префикс v учитывается', c.vprefix === true);
  check('сравнение по числам, а не строкам', c.multi === true, cmp);

  const banner = await cdp.eval(`(() => {
    Update.render({ version: '9.9.9', url: 'https://example.com/ArendaLog.apk' });
    const b = document.getElementById('updateBox');
    return JSON.stringify({ shown: b.className.indexOf('hide') < 0, text: b.innerText, html: b.innerHTML });
  })()`);
  const bn = JSON.parse(banner);
  check('баннер обновления отрисован', bn.shown === true, banner);
  check('в баннере версия', /9\.9\.9/.test(bn.text || ''), bn.text);
  check('в баннере ссылка на APK', /ArendaLog\.apk/.test(bn.html || ''), bn.html);

  console.log('\n[13] Помощь и условия');
  await cdp.eval('UI.showTab("settings")');
  await sleep(400);
  await cdp.eval('document.querySelector("#btnFaq").click()');
  await sleep(400);
  const faqText = await cdp.eval('document.querySelector("#modalBody").textContent');
  check('частые вопросы открываются', /Где хранятся мои записи/.test(faqText || ''), (faqText || '').slice(0, 60));
  check('FAQ объясняет перенос на новый телефон', /копию/i.test(faqText || ''));
  await cdp.eval('document.querySelector("#modalClose").click()');
  await sleep(300);
  await cdp.eval('document.querySelector("#btnTerms").click()');
  await sleep(400);
  const termsText = await cdp.eval('document.querySelector("#modalBody").textContent');
  check('условия использования открываются', /Никаких гарантий|Ваши данные/.test(termsText || ''), (termsText || '').slice(0, 60));
  await cdp.eval('document.querySelector("#modalClose").click()');

  console.log('\n[14] Фото в чек-листе приёмки');
  await cdp.eval('UI.showTab("handover")');
  await sleep(400);
  await cdp.eval('document.querySelector("[data-hv=\\"accept\\"]").click()');
  await sleep(700);
  const shots = await cdp.eval('document.querySelectorAll(".room .item .shotbtn").length');
  check('у каждого пункта есть кнопка «Фото»', shots > 20, shots);
  const slots = await cdp.eval('document.querySelectorAll(".room .item .item-shots").length');
  check('у каждого пункта есть место под снимки', slots === shots, slots);
  await cdp.eval('document.querySelector("#modalClose").click()');

  console.log('\n════════════════════════');
  console.log('Пройдено: ' + pass + ' · Провалено: ' + fail);
  try { ws.close(); } catch (e) { }
  try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) { }
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('ТЕСТ УПАЛ: ' + e.message);
  process.exit(2);
});
