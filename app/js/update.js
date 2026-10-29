/* АрендаЛог — проверка обновлений и диагностика связи с GitHub */
(function (global) {
  'use strict';
  const { U, DB } = global.AL;

  const REPO = 'luckyvoron-tech/arendalog';
  const CURRENT = '1.0.8';
  const CHECK_INTERVAL = 6 * 3600 * 1000;
  const TIMEOUT = 12000;

  const API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  const APK = 'https://github.com/' + REPO + '/releases/latest/download/ArendaLog.apk';

  async function fetchWithTimeout(url, opts, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || TIMEOUT);
    try {
      return await fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  function parse(v) { return String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0); }
  function isNewer(remote, local) {
    const a = parse(remote), b = parse(local);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  const UPD = {
    current: CURRENT,
    isNewer,
    parse,

    /* возвращает { ok, version, url, notes, error } */
    async request() {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { ok: false, error: 'нет сети (телефон сообщает об отсутствии подключения)' };
      }
      try {
        const r = await fetchWithTimeout(API, { headers: { Accept: 'application/vnd.github+json' } });
        if (!r.ok) {
          return {
            ok: false,
            error: 'GitHub ответил HTTP ' + r.status +
              (r.status === 403 ? ' (лимит запросов, попробуйте позже)' : '')
          };
        }
        const rel = await r.json();
        const version = String(rel.tag_name || '').replace(/^v/i, '');
        const assets = rel.assets || [];
        const apk = assets.find(a => /\.apk$/i.test(a.name)) || assets[0];
        return {
          ok: true,
          version,
          url: apk ? apk.browser_download_url : rel.html_url,
          notes: rel.body || '',
          published: rel.published_at
        };
      } catch (e) {
        const msg = e && e.name === 'AbortError'
          ? 'нет ответа за ' + Math.round(TIMEOUT / 1000) + ' с — похоже, сеть блокирует api.github.com'
          : (e && e.message ? e.message : 'неизвестная ошибка');
        return { ok: false, error: msg };
      }
    },

    /* тихая проверка при запуске */
    async check(silent) {
      if (silent) {
        const last = await DB.getSet('lastUpdateCheck', 0);
        const cached = await DB.getSet('updateCache', null);
        if (cached && last && Date.now() - last < CHECK_INTERVAL) {
          if (cached.ok && isNewer(cached.version, CURRENT)) UPD.render(cached);
          return cached;
        }
      }
      const res = await UPD.request();
      await DB.set('lastUpdateCheck', Date.now());
      await DB.set('updateCache', res);
      await DB.set('updateCheckedAt', new Date().toISOString());
      if (res.ok && isNewer(res.version, CURRENT)) UPD.render(res);
      else UPD.hide();
      return res;
    },

    /* скачивание APK в «Загрузки»: установку запускает сам пользователь —
       приложению не нужно разрешение на установку, и Play Protect не ругается */
    download(url) {
      try {
        if (typeof AndroidBridge !== 'undefined' && AndroidBridge && AndroidBridge.downloadUpdate) {
          const raw = AndroidBridge.downloadUpdate(url);
          const res = raw ? JSON.parse(raw) : null;
          if (res && res.ok) return res;
          if (res && res.error) global.UI.toast('Не удалось скачать: ' + res.error);
        }
      } catch (e) { }
      return null;
    },

    openDownloads() {
      try {
        if (typeof AndroidBridge !== 'undefined' && AndroidBridge && AndroidBridge.openDownloads) {
          AndroidBridge.openDownloads();
          return true;
        }
      } catch (e) { }
      return false;
    },

    /* диалог после скачивания: что делать дальше */
    showDownloaded(url) {
      const body = document.createElement('div');
      body.innerHTML =
        '<div class="card" style="border-color:rgba(47,191,113,.45);background:rgba(47,191,113,.08)">' +
        '<b style="color:#a9e8c4">Файл скачан</b>' +
        '<div class="muted small" style="margin-top:6px">Он лежит в папке «Загрузки»</div></div>' +
        '<div class="card"><b>Как установить</b>' +
        '<ol style="margin:8px 0 0;padding-left:20px;font-size:14px">' +
        '<li>нажмите «Открыть Загрузки»;</li>' +
        '<li>откройте файл <b>ArendaLog-…apk</b>;</li>' +
        '<li>подтвердите установку — данные сохранятся.</li>' +
        '</ol></div>' +
        '<button class="btn primary" id="updOpenDl">Открыть Загрузки</button>' +
        '<a class="btn" href="' + U.esc(url) + '" style="text-decoration:none;display:block;text-align:center;margin-top:8px">Или скачать через браузер</a>';
      const openBtn = body.querySelector('#updOpenDl');
      openBtn.addEventListener('click', () => {
        if (!UPD.openDownloads()) global.UI.toast('Откройте приложение «Файлы» → «Загрузки»');
      });
      global.UI.openModal('Обновление скачано', body);
    },

    render(info) {
      const box = document.getElementById('updateBox');
      if (!box || !info || info.ok === false) return;
      box.className = 'integrity';
      box.style.background = 'rgba(76,141,255,.12)';
      box.style.borderColor = 'rgba(76,141,255,.45)';
      box.style.color = '#cfe0ff';
      box.innerHTML = '⬆️ Доступна версия ' + U.esc(info.version) + ' · ' +
        '<a href="' + U.esc(info.url) + '" id="updBannerGo" style="color:#fff;font-weight:700;text-decoration:underline">обновить</a>';
      const go = box.querySelector('#updBannerGo');
      if (go) go.addEventListener('click', function (e) {
        e.preventDefault();
        const res = UPD.download(info.url);
        if (res) UPD.showDownloaded(info.url);
        else window.open(info.url, '_blank');
      });
    },

    hide() {
      const box = document.getElementById('updateBox');
      if (box) { box.className = 'integrity hide'; box.innerHTML = ''; }
    },

    /* ручная проверка: результат всегда показывается диалогом */
    async manual() {
      const wait = document.createElement('div');
      wait.innerHTML = '<div class="card"><b>Проверяю обновления…</b>' +
        '<div class="muted small" style="margin-top:6px">Запрос к GitHub, до 12 секунд.</div></div>';
      global.UI.openModal('Обновления', wait);

      const res = await UPD.request();
      await DB.set('lastUpdateCheck', Date.now());
      await DB.set('updateCache', res);
      await DB.set('updateCheckedAt', new Date().toISOString());

      const checkedAt = U.fmtDateTime(new Date().toISOString());
      const body = document.createElement('div');

      if (!res.ok) {
        body.innerHTML =
          '<div class="card" style="border-color:#6b2b30;background:#211517">' +
          '<b style="color:#ffb3b4">Не удалось проверить</b>' +
          '<div style="margin-top:8px;font-size:14px">' + U.esc(res.error) + '</div></div>' +
          '<div class="card">' +
          '<div class="kv"><span>Ваша версия</span><b>' + U.esc(CURRENT) + '</b></div>' +
          '<div class="kv"><span>Время проверки</span><b>' + U.esc(checkedAt) + '</b></div></div>' +
          '<div class="card"><b>Что можно сделать</b>' +
          '<ul style="margin:8px 0 0;padding-left:20px;font-size:14px">' +
          '<li>проверьте интернет (Wi-Fi или мобильные данные);</li>' +
          '<li>повторите через минуту — GitHub ограничивает частоту запросов;</li>' +
          '<li>скачайте обновление вручную: <a href="' + APK + '" style="color:#cfe0ff">ссылка на APK</a>.</li>' +
          '</ul></div><button class="btn primary" id="updRetry">Повторить</button>';
        const retry = body.querySelector('#updRetry');
        if (retry) retry.addEventListener('click', () => { global.UI.closeModal(); UPD.manual(); });
      } else if (isNewer(res.version, CURRENT)) {
        body.innerHTML =
          '<div class="card" style="border-color:rgba(47,191,113,.45);background:rgba(47,191,113,.08)">' +
          '<b style="color:#a9e8c4">Доступна версия ' + U.esc(res.version) + '</b>' +
          '<div class="muted small" style="margin-top:6px">Установлена ' + U.esc(CURRENT) + '</div></div>' +
          '<button class="btn primary" id="updDownload">Скачать обновление</button>' +
          '<a class="btn" href="' + U.esc(res.url) + '" style="text-decoration:none;display:block;text-align:center;margin-top:8px">Открыть в браузере</a>' +
          '<p class="muted small" style="margin-top:10px">Файл скачается в «Загрузки». Откройте его и подтвердите установку — данные сохранятся.</p>';
        const dl = body.querySelector('#updDownload');
        if (dl) dl.addEventListener('click', () => {
          const got = UPD.download(res.url);
          if (got) UPD.showDownloaded(res.url);
          else {
            global.UI.toast('Открываю ссылку в браузере');
            window.open(res.url, '_blank');
          }
        });
        UPD.render(res);
      } else {
        body.innerHTML =
          '<div class="card" style="border-color:rgba(47,191,113,.45);background:rgba(47,191,113,.08)">' +
          '<b style="color:#a9e8c4">У вас последняя версия</b>' +
          '<div class="muted small" style="margin-top:6px">' + U.esc(CURRENT) + ' — это самая свежая сборка</div></div>' +
          '<div class="card"><div class="kv"><span>На GitHub</span><b>' + U.esc(res.version) + '</b></div>' +
          '<div class="kv"><span>Проверено</span><b>' + U.esc(checkedAt) + '</b></div></div>';
        UPD.hide();
      }
      global.UI.openModal('Обновления', body);
      global.UI.refreshVersionCard();
    },

    /* диагностика: что именно доступно с этого устройства */
    async diagnose() {
      const rows = [];
      const wait = document.createElement('div');
      wait.innerHTML = '<div class="card"><b>Проверяю связь…</b>' +
        '<div class="muted small" style="margin-top:6px">Три запроса, до 12 секунд каждый.</div></div>';
      global.UI.openModal('Диагностика связи', wait);

      async function probe(name, url, mode) {
        const t0 = Date.now();
        try {
          const opts = mode === 'cors'
            ? { headers: { Accept: 'application/vnd.github+json' } }
            : { mode: 'no-cors' };
          await fetchWithTimeout(url, opts, 12000);
          rows.push({ name: name, ok: true, detail: (mode === 'cors' ? 'отвечает' : 'доступен') + ' · ' + (Date.now() - t0) + ' мс' });
        } catch (e) {
          const why = (e && e.name === 'AbortError') ? 'нет ответа за 12 с' : (e && e.message ? e.message : 'ошибка');
          rows.push({ name: name, ok: false, detail: why });
        }
      }

      await probe('GitHub API', API, 'cors');
      await probe('Скачивание APK', APK, 'no-cors');
      await probe('Сервер меток времени', (global.UI.state.tsaUrl || 'https://freetsa.org/tsr'), 'no-cors');

      const okCount = rows.filter(function (r) { return r.ok; }).length;
      const body = document.createElement('div');
      body.innerHTML =
        '<div class="card">' +
        '<div class="kv"><span>Интернет</span><b>' + (navigator.onLine ? 'есть' : 'нет') + '</b></div>' +
        rows.map(function (r) {
          return '<div class="kv"><span>' + U.esc(r.name) + '</span>' +
            '<b style="color:' + (r.ok ? '#a9e8c4' : '#ffb3b4') + '">' + U.esc(r.detail) + '</b></div>';
        }).join('') +
        '</div>' +
        '<div class="card"><b>' +
        (okCount === rows.length ? 'Всё доступно' : (okCount ? 'Частично доступно' : 'Ничего не доступно')) +
        '</b><div class="muted small" style="margin-top:6px">' +
        (okCount === rows.length
          ? 'Обновления и метки времени должны работать.'
          : 'Если GitHub недоступен — обновление можно скачать по прямой ссылке, а метки времени копятся в очереди и отправятся позже.') +
        '</div></div>' +
        '<a class="btn" href="' + APK + '" style="text-decoration:none;display:block;text-align:center">Открыть ссылку на APK</a>';
      global.UI.openModal('Диагностика связи', body);
    }
  };

  global.Update = UPD;
})(window);
