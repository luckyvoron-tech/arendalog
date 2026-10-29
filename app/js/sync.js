/* АрендаЛог — общий доступ: синхронизация с сервером, приглашения, реальное время */
(function (global) {
  'use strict';
  const { U, DB, Bridge } = global.AL;

  const S = {
    cfg: { url: '', spaceId: '', token: '', role: '', lastSseq: 0 },
    live: null,

    async load() {
      const c = await DB.getSet('sync', null);
      if (c) S.cfg = Object.assign(S.cfg, c);
      S.render();
      return S.cfg;
    },

    async save() {
      await DB.set('sync', S.cfg);
      S.render();
    },

    connected() { return !!(S.cfg.url && S.cfg.spaceId && S.cfg.token); },

    api(method, p, body, isRaw) {
      const url = S.cfg.url.replace(/\/$/, '') + p;
      const headers = { 'Authorization': 'Bearer ' + S.cfg.token };
      if (body && !isRaw) headers['Content-Type'] = 'application/json';
      return fetch(url, {
        method, headers,
        body: body ? (isRaw ? body : JSON.stringify(body)) : undefined
      }).then(async r => {
        const ct = r.headers.get('content-type') || '';
        const data = ct.includes('json') ? await r.json() : await r.arrayBuffer();
        if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
        return data;
      });
    },

    /* ── создание пространства на сервере ── */
    async createSpace() {
      const url = ($('#fServer').value || '').trim().replace(/\/$/, '');
      if (!url) { UI.toast('Укажите адрес сервера'); return; }
      const kp = await global.AL.Crypto.ensureKeys();
      UI.toast('Создаю пространство…');
      try {
        const res = await fetch(url + '/api/space', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: UI.state.journal.title, pubHex: kp.pubHex,
            journal: UI.state.journal
          })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
        const data = await res.json();
        S.cfg = { url, spaceId: data.spaceId, token: data.token, role: 'owner', lastSseq: 0 };
        await S.save();
        await S.pushMeta();
        UI.toast('Пространство создано: ' + data.spaceId);
        await S.showCodes(data.codes);
      } catch (e) {
        UI.toast('Не удалось: ' + e.message);
      }
    },

    /* ── вход по коду приглашения ── */
    async join() {
      const code = prompt('Вставьте код приглашения\n(вида: https://сервер#spaceId:токен)');
      if (!code) return;
      const m = String(code).trim().match(/^(.*)#([0-9a-f]+):([0-9a-zA-Z]+)$/);
      if (!m) { UI.toast('Код не распознан'); return; }
      S.cfg = { url: m[1].replace(/\/$/, ''), spaceId: m[2], token: m[3], role: '', lastSseq: 0 };
      try {
        const info = await S.api('GET', '/api/space/' + S.cfg.spaceId);
        S.cfg.role = info.role;
        await S.applyMeta(info);
        if (info.role === 'read') {
          await DB.set('readOnly', true);
          UI.state.readOnly = true;
        }
        await S.save();
        await S.pull(true);
        UI.toast('Подключено: ' + info.title + ' · ' + (info.role === 'read' ? 'просмотр' : 'редактирование'));
        if (info.role === 'read') UI.renderHeader();
      } catch (e) {
        UI.toast('Код не сработал: ' + e.message);
      }
    },

    async applyMeta(info) {
      if (!info || !info.meta) return;
      const j = UI.state.journal;
      if (info.meta.journal) {
        for (const k of ['title', 'address', 'tenant', 'landlord', 'landlordPhone', 'deposit', 'rent', 'start', 'end']) {
          if (info.meta.journal[k] != null) j[k] = info.meta.journal[k];
        }
      }
      if (Array.isArray(info.meta.zones) && info.meta.zones.length) j.zones = info.meta.zones;
      if (Array.isArray(info.meta.people)) j.people = info.meta.people;
      if (info.pubHex) j.pubHex = info.pubHex;
      await DB.put('journals', j);
    },

    async pushMeta() {
      if (!S.connected()) return;
      try {
        await S.api('PUT', '/api/space/' + S.cfg.spaceId + '/meta', {
          meta: {
            journal: UI.state.journal,
            zones: UI.state.journal.zones || [],
            people: UI.state.journal.people || []
          },
          pubHex: UI.state.journal.pubHex
        });
      } catch (e) { /* офлайн — отправим при следующей синхронизации */ }
    },

    /* ── отправка своих событий ── */
    async push() {
      if (!S.connected()) throw new Error('не подключено');
      if (S.cfg.role === 'read') return { events: 0, photos: 0 };
      const all = await DB.byIndex('events', 'journalId', UI.state.journal.id);
      const pending = all.filter(e => !e.synced);
      let photosSent = 0;

      // сначала вложения
      const photoIndex = {};
      for (const ev of pending) {
        for (const pid of ev.photos || []) {
          const ph = await DB.get('photos', pid);
          if (!ph) continue;
          if (!photoIndex[ph.sha256]) {
            photoIndex[ph.sha256] = { mime: ph.mime, size: ph.blob.size, ids: [] };
          }
          photoIndex[ph.sha256].ids.push(pid);
          if (!ph.synced) {
            try {
              const buf = new Uint8Array(await ph.blob.arrayBuffer());
              await S.api('POST', '/api/space/' + S.cfg.spaceId + '/blob', buf, true);
              ph.synced = true;
              await DB.put('photos', ph);
              photosSent++;
            } catch (e) { /* повторим позже */ }
          }
        }
      }

      if (!pending.length) return { events: 0, photos: photosSent };

      const res = await S.api('POST', '/api/space/' + S.cfg.spaceId + '/events', {
        events: pending, photos: photoIndex
      });
      for (const ev of pending) {
        ev.synced = true;
        await DB.put('events', ev);
      }
      return { events: res.accepted, photos: photosSent, rejected: res.rejected };
    },

    /* ── приём чужих событий ── */
    async pull(silent) {
      if (!S.connected()) throw new Error('не подключено');
      const data = await S.api('GET', '/api/space/' + S.cfg.spaceId + '/events?since=' + (S.cfg.lastSseq || 0));
      let added = 0;
      const known = new Set((await DB.byIndex('events', 'journalId', UI.state.journal.id)).map(e => e.id));
      for (const ev of data.events || []) {
        if (known.has(ev.id)) continue;
        ev.synced = true;
        await DB.put('events', ev);
        known.add(ev.id);
        added++;
      }
      // мета и вложения
      if (data.meta && (data.metaVersion || 0) > (S.cfg.metaVersion || 0)) {
        await S.applyMeta({ meta: data.meta, pubHex: data.pubHex });
        S.cfg.metaVersion = data.metaVersion;
        await S.save();
      }
      for (const sha of Object.keys(data.photos || {})) {
        const rec = data.photos[sha];
        for (const pid of rec.ids || []) {
          const exists = await DB.get('photos', pid);
          if (exists) continue;
          try {
            const buf = await S.api('GET', '/api/blob/' + sha + '?space=' + S.cfg.spaceId);
            await DB.put('photos', {
              id: pid, journalId: UI.state.journal.id, eventId: null,
              blob: new Blob([buf], { type: rec.mime || 'image/jpeg' }),
              mime: rec.mime, sha256: sha, ts: U.nowISO(), kind: 'photo', synced: true
            });
          } catch (e) { /* пропустим */ }
        }
      }
      S.cfg.lastSseq = data.lastSeq || S.cfg.lastSseq;
      await S.save();
      if (added || !silent) {
        await UI.loadAll();
        UI.renderHandovers();
      }
      return { added, lastSeq: data.lastSeq };
    },

    async syncNow() {
      if (!S.connected()) { UI.toast('Сначала создайте пространство или войдите по коду'); return; }
      const btn = $('#btnSyncNow');
      btn.disabled = true;
      try {
        const p = await S.push();
        const r = await S.pull();
        UI.toast(`Отправлено: ${p.events}, получено: ${r.added}`);
      } catch (e) {
        UI.toast('Синхронизация не удалась: ' + e.message);
      } finally {
        btn.disabled = false;
      }
    },

    /* ── реальное время ── */
    startLive() {
      if (!S.connected()) { UI.toast('Сначала подключитесь'); return; }
      if (S.live) { UI.toast('Уже следим'); return; }
      const url = S.cfg.url.replace(/\/$/, '') + '/api/space/' + S.cfg.spaceId +
        '/stream?token=' + encodeURIComponent(S.cfg.token);
      try {
        S.live = new EventSource(url);
        S.live.addEventListener('hello', () => UI.toast('Слежение включено'));
        S.live.addEventListener('events', async ev => {
          let payload = {};
          try { payload = JSON.parse(ev.data); } catch (e) { }
          if (payload.type === 'events') {
            const r = await S.pull(true);
            if (r.added) UI.toast('Новые записи: ' + r.added);
          } else if (payload.type === 'meta') {
            const info = await S.api('GET', '/api/space/' + S.cfg.spaceId);
            await S.applyMeta(info);
            UI.renderHeader();
          }
        });
        S.live.onerror = () => { UI.toast('Поток прерван, повторю…'); };
        S.render();
      } catch (e) {
        UI.toast('Не удалось включить слежение: ' + e.message);
      }
    },

    stopLive() {
      if (S.live) { S.live.close(); S.live = null; }
      S.render();
    },

    /* ── приглашения ── */
    async invite(role) {
      if (!S.connected()) { UI.toast('Сначала создайте пространство'); return; }
      try {
        const r = await fetch(S.cfg.url.replace(/\/$/, '') + '/api/space/' + S.cfg.spaceId + '/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.cfg.token },
          body: JSON.stringify({ role })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        S.showCode(role, data.code);
      } catch (e) {
        UI.toast('Приглашение не создано: ' + e.message);
      }
    },

    showCode(role, code) {
      const wrap = el('div');
      wrap.innerHTML = `
        <p class="muted small">Отправьте этот код человеку. Он откроет приложение → «Ещё» → «Общий доступ» →
        «Войти по коду» и вставит его.</p>
        <label>Код приглашения (${role === 'read' ? 'только просмотр' : 'редактирование'})
          <textarea id="invCode" rows="3" style="font-size:13px">${U.esc(code)}</textarea>
        </label>
        <button class="btn primary" id="invCopy">Скопировать</button>
        <p class="muted small">Код даёт доступ к журналу на выбранном сервере. Не публикуйте его.</p>
      `;
      wrap.querySelector('#invCopy').addEventListener('click', async () => {
        const v = wrap.querySelector('#invCode').value;
        try { await navigator.clipboard.writeText(v); UI.toast('Скопировано'); }
        catch (e) { wrap.querySelector('#invCode').select(); UI.toast('Выделено — скопируйте вручную'); }
      });
      openModal('Приглашение', wrap);
    },

    async showCodes(codes) {
      const wrap = el('div');
      wrap.innerHTML = `
        <p class="muted small">Пространство создано. Два кода: для арендодателя (просмотр) и для проживающих (редактирование).</p>
        <label>Арендодателю — просмотр
          <textarea id="cRead" rows="2" style="font-size:13px">${U.esc(codes.read || '')}</textarea>
        </label>
        <label>Проживающим — редактирование
          <textarea id="cWrite" rows="2" style="font-size:13px">${U.esc(codes.write || '')}</textarea>
        </label>
        <button class="btn primary" id="cCopy">Скопировать для арендодателя</button>
      `;
      wrap.querySelector('#cCopy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(wrap.querySelector('#cRead').value); UI.toast('Скопировано'); }
        catch (e) { wrap.querySelector('#cRead').select(); }
      });
      openModal('Коды приглашений', wrap);
    },

    render() {
      const box = $('#syncState');
      if (!box) return;
      if (!S.connected()) { box.textContent = 'не подключён'; return; }
      const role = S.cfg.role === 'read' ? 'просмотр' : S.cfg.role === 'owner' ? 'владелец' : 'редактирование';
      box.textContent = `${S.cfg.spaceId} · ${role}` + (S.live ? ' · live' : '');
      const f = $('#fServer');
      if (f && !f.value) f.value = S.cfg.url;
    }
  };

  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (html != null) n.innerHTML = html;
    return n;
  }
  const $ = s => document.querySelector(s);

  global.Sync = S;
})(window);
