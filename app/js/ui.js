/* АрендаЛог — интерфейс */
(function (global) {
  'use strict';
  const { U, DB, Crypto, TSA, Bridge, Zip } = global.AL;

  const TYPES = {
    defect: { label: 'Проблема', ico: '⚠️', cls: 't-defect' },
    improvement: { label: 'Улучшение', ico: '🔧', cls: 't-improvement' },
    receipt: { label: 'Чек', ico: '🧾', cls: 't-receipt' },
    payment: { label: 'Платёж', ico: '💰', cls: 't-payment' },
    meter: { label: 'Показания', ico: '📊', cls: 't-meter' },
    notice: { label: 'Уведомление', ico: '📨', cls: 't-notice' },
    note: { label: 'Заметка', ico: '📝', cls: 't-note' }
  };

  const ROOM_PRESET = [
    { name: 'Кухня', items: ['Стены и потолок', 'Пол', 'Кухонный гарнитур', 'Плита', 'Вытяжка', 'Мойка и смеситель', 'Холодильник', 'Духовка', 'Посудомоечная машина', 'Двери и окна', 'Розетки и освещение'] },
    { name: 'Гостиная', items: ['Стены и потолок', 'Пол', 'Диван', 'Шкафы и полки', 'Окна и двери', 'Освещение', 'Розетки', 'Кондиционер'] },
    { name: 'Спальня 1', items: ['Стены и потолок', 'Пол', 'Кровать', 'Шкаф', 'Окна и двери', 'Освещение', 'Розетки'] },
    { name: 'Спальня 2', items: ['Стены и потолок', 'Пол', 'Кровать', 'Шкаф', 'Окна и двери', 'Освещение', 'Розетки'] },
    { name: 'Санузел', items: ['Стены и потолок', 'Пол', 'Унитаз', 'Раковина', 'Душ или ванна', 'Смесители', 'Вентиляция', 'Полотенцесушитель'] },
    { name: 'Прихожая', items: ['Стены и потолок', 'Пол', 'Двери', 'Шкаф', 'Освещение'] },
    { name: 'Двор и терраса', items: ['Ограждение', 'Настил', 'Освещение', 'Ворота и калитка'] },
    { name: 'Коммуникации', items: ['Электрощит', 'Счётчики', 'Водоснабжение', 'Насос', 'Канализация и септик', 'Отопление', 'Интернет'] }
  ];

  /* шаблоны наборов зон */
  const ZONE_TEMPLATES = {
    house: {
      title: 'Дом', desc: 'Кухня, гостиная, две спальни, санузел, прихожая, двор, коммуникации',
      zones: ROOM_PRESET
    },
    flat: {
      title: 'Квартира', desc: 'Кухня, гостиная, спальня, санузел, прихожая, балкон',
      zones: [
        { name: 'Кухня', items: ['Стены и потолок', 'Пол', 'Кухонный гарнитур', 'Плита', 'Вытяжка', 'Мойка и смеситель', 'Холодильник', 'Двери и окна', 'Розетки и освещение'] },
        { name: 'Гостиная', items: ['Стены и потолок', 'Пол', 'Диван', 'Шкафы и полки', 'Окна и двери', 'Освещение', 'Розетки', 'Кондиционер'] },
        { name: 'Спальня', items: ['Стены и потолок', 'Пол', 'Кровать', 'Шкаф', 'Окна и двери', 'Освещение', 'Розетки'] },
        { name: 'Санузел', items: ['Стены и потолок', 'Пол', 'Унитаз', 'Раковина', 'Душ или ванна', 'Смесители', 'Вентиляция', 'Полотенцесушитель'] },
        { name: 'Прихожая', items: ['Стены и потолок', 'Пол', 'Двери', 'Шкаф', 'Освещение'] },
        { name: 'Балкон или лоджия', items: ['Остекление', 'Пол', 'Освещение'] }
      ]
    },
    studio: {
      title: 'Студия', desc: 'Одна комната, кухонная зона, санузел, прихожая',
      zones: [
        { name: 'Комната', items: ['Стены и потолок', 'Пол', 'Мебель', 'Окна и двери', 'Освещение', 'Розетки'] },
        { name: 'Кухонная зона', items: ['Гарнитур', 'Плита', 'Мойка', 'Холодильник', 'Вытяжка'] },
        { name: 'Санузел', items: ['Стены и потолок', 'Пол', 'Унитаз', 'Раковина', 'Душ', 'Смесители', 'Вентиляция'] },
        { name: 'Прихожая', items: ['Стены и потолок', 'Пол', 'Двери', 'Освещение'] }
      ]
    },
    houseplot: {
      title: 'Дом с участком', desc: 'Дом, двор, мангальная зона, коммуникации',
      zones: ROOM_PRESET.concat([
        { name: 'Мангальная зона', items: ['Мангал', 'Стол и навес', 'Освещение', 'Пол или настил', 'Ограждение'] },
        { name: 'Столовая на улице', items: ['Стол', 'Стулья', 'Навес', 'Освещение'] }
      ])
    },
    empty: { title: 'Пустой список', desc: 'Начну с нуля', zones: [] }
  };

  const ROLES = ['арендатор', 'супруг(а)', 'ребёнок', 'родственник', 'друг', 'арендодатель', 'другое'];

  function defaultZones() {
    return ROOM_PRESET.map(r => ({
      id: U.uid(), name: r.name, note: '',
      items: r.items.slice()
    }));
  }

  const state = {
    journal: null,
    events: [],
    handovers: [],
    photos: {},
    photoUrl: {},
    filter: 'all',
    tsaUrl: 'https://freetsa.org/tsr',
    pendingPhotos: []
  };

  /* ─────────────── DOM-хелперы ─────────────── */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'dataset') Object.assign(n.dataset, attrs[k]);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  }
  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2400);
    Bridge.vibrate(15);
  }

  /* ─────────────── Модальное окно ─────────────── */
  function openModal(title, bodyNode) {
    $('#modalTitle').textContent = title;
    const body = $('#modalBody');
    body.innerHTML = '';
    body.appendChild(bodyNode);
    $('#modal').classList.add('open');
  }
  function closeModal() { $('#modal').classList.remove('open'); }

  /* ─────────────── Экраны ─────────────── */
  function showTab(name) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    window.scrollTo(0, 0);
    if (name === 'report') renderStats();
    if (name === 'object') { renderObject(); renderDeadlines(); }
  }

  /* ─────────────── Загрузка состояния ─────────────── */
  async function loadAll() {
    state.tsaUrl = (await DB.getSet('tsaUrl', 'https://freetsa.org/tsr')) || 'https://freetsa.org/tsr';
    let jid = await DB.getSet('activeJournal', null);
    let journals = await DB.all('journals');
    if (!journals.length) {
      const j = {
        id: U.uid(), title: 'АрендаЛог', address: '', tenant: '', landlord: '',
        landlordPhone: '', deposit: '', rent: '', start: '', end: '', createdAt: U.nowISO()
      };
      await DB.put('journals', j);
      await DB.set('activeJournal', j.id);
      jid = j.id; journals = [j];
    }
    state.journal = journals.find(j => j.id === jid) || journals[0];
    await DB.set('activeJournal', state.journal.id);
    const kpNow = await Crypto.ensureKeys();
    if (!state.journal.pubHex) {
      state.journal.pubHex = kpNow.pubHex;
      await saveJournal();
    }
    // миграция: у старых журналов нет зон и списка проживающих
    let changed = false;
    if (!Array.isArray(state.journal.zones) || !state.journal.zones.length) {
      state.journal.zones = defaultZones();
      changed = true;
    }
    if (!Array.isArray(state.journal.people)) {
      state.journal.people = [];
      changed = true;
    }
    if (changed) await saveJournal();
    state.viewerJwk = await DB.getSet('viewerKey', null);
    state.events = (await DB.byIndex('events', 'journalId', state.journal.id)).sort((a, b) => a.seq - b.seq);
    state.handovers = (await DB.byIndex('handovers', 'journalId', state.journal.id)).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const photos = await DB.byIndex('photos', 'journalId', state.journal.id);
    state.photos = {};
    state.photoUrl = {};
    photos.forEach(p => {
      state.photos[p.id] = p;
      state.photoUrl[p.id] = URL.createObjectURL(p.blob);
    });
    renderHeader();
    renderTimeline();
    renderStats();
    refreshTsaInfo();
    refreshBackupBanner();
  }

  function renderHeader() {
    const j = state.journal;
    $('#objTitle').textContent = j.title || 'АрендаЛог';
    $('#objSub').textContent = j.address || 'журнал аренды и доказательства';
  }

  /* ─────────────── Журнал ─────────────── */
  function renderTimeline() {
    const box = $('#timeline');
    box.innerHTML = '';
    const list = state.events.filter(e => state.filter === 'all' || e.type === state.filter).slice().reverse();
    $('#timelineEmpty').style.display = list.length ? 'none' : 'block';
    for (const ev of list) box.appendChild(eventCard(ev));
    renderIntegrity();
  }

  function eventCard(ev) {
    const t = TYPES[ev.type] || TYPES.note;
    const card = el('div', { class: 'ev ' + t.cls });
    const atts = (ev.photos || []).map(pid => state.photos[pid]).filter(Boolean);
    const photos = atts.filter(a => (a.kind || 'photo') === 'photo').map(a => state.photoUrl[a.id]).filter(Boolean);
    const docs = atts.filter(a => a.kind === 'doc');
    const tsaBadge = ev.tsa
      ? `<span class="badge ok">время подтверждено</span>`
      : `<span class="badge warn">ждёт подтверждения</span>`;
    const cp = ev.meta && ev.meta.counterparty ? ev.meta.counterparty : '';
    card.innerHTML = `
      <div class="ev-head">
        <span class="ev-type" style="color:${ev.type === 'defect' ? '#ef5b5b' : ev.type === 'improvement' ? '#2fbf71' : ev.type === 'receipt' ? '#ff9f43' : '#8d99a8'}">${t.ico} ${t.label}</span>
        <span class="ev-date">${U.fmtDateTime(ev.tsDevice)}</span>
      </div>
      <div class="ev-title">${U.esc(ev.title || t.label)}${ev.amount ? ` · <span class="ev-amount">${U.money(ev.amount)}</span>` : ''}</div>
      ${cp ? `<div class="ev-note">${U.esc(cp)}</div>` : ''}
      ${ev.note ? `<div class="ev-note">${U.esc(ev.note)}</div>` : ''}
      <div class="ev-meta">
        ${ev.room ? `<span class="badge">${U.esc(ev.room)}</span>` : ''}
        ${ev.severity ? `<span class="badge">${U.esc(ev.severity)}</span>` : ''}
        ${photos.length ? `<span class="badge">${photos.length} фото</span>` : ''}
        ${docs.length ? `<span class="badge">${docs.length} док.</span>` : ''}
        ${tsaBadge}
        <span class="badge mono">#${ev.seq} · ${(ev.hash || '').slice(0, 8)}</span>
      </div>
      ${photos.length ? `<div class="ev-thumbs">${photos.slice(0, 6).map(u => `<img src="${u}" alt="">`).join('')}</div>` : ''}
      ${docs.length ? `<div class="ev-meta">${docs.map(d => `<span class="badge">📎 ${U.esc(d.name || 'документ')}</span>`).join('')}</div>` : ''}
    `;
    card.addEventListener('click', () => eventDetails(ev));
    return card;
  }

  function eventDetails(ev) {
    const wrap = el('div');
    const t = TYPES[ev.type] || TYPES.note;
    const photos = (ev.photos || []).map(pid => state.photoUrl[pid]).filter(Boolean);
    wrap.innerHTML = `
      <div class="card">
        <div class="kv"><span>Тип</span><b>${t.ico} ${t.label}</b></div>
        <div class="kv"><span>Время устройства</span><b>${U.fmtDateTime(ev.tsDevice)}</b></div>
        <div class="kv"><span>Подтверждено сервером времени</span><b>${ev.tsa ? U.fmtDateTime(ev.tsa.time) : 'ожидает'}</b></div>
        ${ev.amount ? `<div class="kv"><span>Сумма</span><b>${U.money(ev.amount)}</b></div>` : ''}
        ${ev.room ? `<div class="kv"><span>Место</span><b>${U.esc(ev.room)}</b></div>` : ''}
        ${ev.severity ? `<div class="kv"><span>Критичность</span><b>${U.esc(ev.severity)}</b></div>` : ''}
        <div class="kv"><span>Номер в цепочке</span><b>#${ev.seq}</b></div>
      </div>
      ${ev.note ? `<div class="card"><div class="muted small">Описание</div><div style="white-space:pre-wrap;margin-top:6px">${U.esc(ev.note)}</div></div>` : ''}
      <div class="card">
        <div class="muted small">Хеш события (SHA-256)</div>
        <div class="mono small" style="word-break:break-all;margin-top:6px">${ev.hash}</div>
        <div class="muted small" style="margin-top:10px">Связь с предыдущим</div>
        <div class="mono small" style="word-break:break-all">${ev.prevHash || '— начало цепочки —'}</div>
        <div class="muted small" style="margin-top:10px">Электронная подпись (ECDSA P-256)</div>
        <div class="mono small" style="word-break:break-all">${ev.sig}</div>
        ${ev.tsa ? `<div class="muted small" style="margin-top:10px">Техническое подтверждение — для юриста</div><div class="mono small" style="word-break:break-all;max-height:120px;overflow:auto">${ev.tsa.token}</div>` : ''}
      </div>
      ${photos.length ? `<div class="card"><div class="photo-grid">${photos.map(u => `<div class="photo-cell"><img src="${u}"></div>`).join('')}</div></div>` : ''}
    `;
    myAuthorId().then(myId => {
      if (ev.authorId && ev.authorId !== myId) return; // чужие записи не удаляем
      const del = el('button', { class: 'btn danger' }, 'Удалить событие');
      del.addEventListener('click', async () => {
        if (!confirm('Удалить событие? Цепочка будет перестроена, а прежний корневой хеш станет недействительным.')) return;
        await DB.del('events', ev.id);
        closeModal();
        await rebuildChain();
        await loadAll();
        toast('Событие удалено');
      });
      wrap.appendChild(del);
    });
    openModal(TYPES[ev.type].label + ' · ' + U.fmtDateTime(ev.tsDevice), wrap);
  }

  function renderIntegrity() {
    const box = $('#integrityBox');
    if (!state.events.length) { box.className = 'integrity hide'; return; }
    box.className = 'integrity';
    box.textContent = '⛓ Цепочка цела · ' + state.events.length + ' событий · подпись ECDSA';
    verifyChain().then(res => {
      if (res.ok) {
        box.className = 'integrity';
        box.textContent = `⛓ Цепочка цела · ${state.events.length} событий · корень ${res.root.slice(0, 12)}…`;
      } else {
        box.className = 'integrity bad';
        box.textContent = '⚠ Целостность нарушена: ' + res.error;
      }
    });
  }

  async function verifySig(hex, sig) {
    try {
      const kp = await Crypto.ensureKeys();
      if (state.journal.pubHex && state.journal.pubHex !== kp.pubHex && state.viewerJwk) {
        return await Crypto.verifyWith(state.viewerJwk, hex, sig);
      }
      return await Crypto.verifyHex(hex, sig);
    } catch (e) { return false; }
  }

  /* проверка цепочек: у каждого автора своя непрерывная ветка */
  async function verifyChain() {
    const myId = await myAuthorId();
    const groups = new Map();
    for (const ev of state.events) {
      const key = (!ev.authorId || ev.authorId === myId) ? 'local' : ev.authorId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    }
    const roots = {};
    for (const [author, list] of groups) {
      list.sort((a, b) => (a.seq || 0) - (b.seq || 0));
      let prev = '';
      for (const ev of list) {
        if ((ev.prevHash || '') !== prev) {
          return { ok: false, error: `разрыв цепочки (автор ${String(author).slice(0, 6)}, #${ev.seq})` };
        }
        const h = await U.sha256Hex(U.canonical(Object.assign({}, baseForHash(ev), { prevHash: ev.prevHash || '' })));
        if (h !== ev.hash) return { ok: false, error: `хеш #${ev.seq} не совпадает` };
        const okSig = await verifySig(ev.hash, ev.sig);
        if (!okSig) return { ok: false, error: `подпись #${ev.seq} неверна` };
        prev = h;
      }
      if (prev) roots[author] = prev;
    }
    const keys = Object.keys(roots).sort();
    return { ok: true, root: keys.map(k => roots[k]).join(':'), roots };
  }

  /* сохранение журнала + отправка метаданных на сервер, если подключено */
  async function saveJournal() {
    await DB.put('journals', state.journal);
  }
  function baseForHash(ev) {
    const base = {
      journalId: ev.journalId, seq: ev.seq, type: ev.type, title: ev.title || '',
      note: ev.note || '', amount: ev.amount || 0, room: ev.room || '',
      severity: ev.severity || '', tsDevice: ev.tsDevice,
      photos: (ev.photos || []).slice(), meta: ev.meta || null
    };
    // у событий, созданных после появления общего доступа, в хеш входит автор
    if (ev.authorId) base.authorId = ev.authorId;
    return base;
  }

  /* идентификатор этого устройства как автора записей */
  async function myAuthorId() {
    let id = await DB.getSet('authorId', null);
    if (!id) { id = U.uid(); await DB.set('authorId', id); }
    return id;
  }

  /* пересборка цепочки после удаления: только свои записи, чужие не трогаем */
  async function rebuildChain() {
    const myId = await myAuthorId();
    const all = await DB.byIndex('events', 'journalId', state.journal.id);
    const list = all.filter(e => !e.authorId || e.authorId === myId).sort((a, b) => a.seq - b.seq);
    let prev = '';
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      ev.seq = i + 1;
      ev.prevHash = prev;
      const h = await U.sha256Hex(U.canonical(Object.assign({}, baseForHash(ev), { prevHash: prev })));
      ev.hash = h;
      ev.sig = await Crypto.signHex(h);
      ev.tsa = null;
      prev = h;
      await DB.put('events', ev);
    }
  }

  /* ─────────────── Добавление события ─────────────── */
  function addEventForm(type) {
    type = type || 'defect';
    const wrap = el('div');
    state.pendingPhotos = [];

    wrap.innerHTML = `
      <div class="chips" id="typeChips">
        ${Object.keys(TYPES).map(k => `<button class="chip ${k === type ? 'active' : ''}" data-t="${k}">${TYPES[k].ico} ${TYPES[k].label}</button>`).join('')}
      </div>
      <label>Кратко
        <input id="eTitle" placeholder="Протечка под мойкой">
      </label>
      <label>Описание
        <textarea id="eNote" placeholder="Что произошло, что сделали, с кем согласовали"></textarea>
      </label>
      <div class="row2">
        <label>Сумма, ₽
          <input id="eAmount" type="number" inputmode="decimal" placeholder="0">
        </label>
        <label>Место
          <input id="eRoom" placeholder="Кухня">
        </label>
      </div>
      <label>Контрагент / магазин
        <input id="eCounterparty" placeholder="Для чеков и платежей — у кого">
      </label>
      <label>Критичность
        <select id="eSeverity">
          <option value="">—</option>
          <option>незначительная</option>
          <option>средняя</option>
          <option>серьёзная</option>
          <option>аварийная</option>
        </select>
      </label>
      <div class="muted small">Фото и документы: 📷 снимок, 📎 чек или PDF</div>
      <div class="photo-grid" id="ePhotos"></div>
      <button class="btn primary" id="eSave">Сохранить и подписать</button>
      <p class="muted small center">Запись сохранится и без интернета — дата подтвердится, когда появится сеть.</p>
    `;

    const photosBox = wrap.querySelector('#ePhotos');
    function renderPhotos() {
      photosBox.innerHTML = '';
      state.pendingPhotos.forEach((p, i) => {
        let cell;
        if (p.kind === 'doc') {
          cell = el('div', {
            class: 'photo-cell',
            style: 'display:flex;align-items:center;justify-content:center;font-size:11px;text-align:center;padding:6px;background:#12161c;line-height:1.2'
          }, `📎<br>${U.esc((p.name || 'файл').slice(0, 20))}<button class="del">✕</button>`);
        } else {
          cell = el('div', { class: 'photo-cell' }, `<img src="${p.url}"><button class="del">✕</button>`);
        }
        cell.querySelector('.del').addEventListener('click', () => {
          if (p.url) URL.revokeObjectURL(p.url);
          state.pendingPhotos.splice(i, 1);
          renderPhotos();
        });
        photosBox.appendChild(cell);
      });
      const addPhoto = el('button', { class: 'addphoto' }, '📷');
      addPhoto.addEventListener('click', pickPhotos);
      photosBox.appendChild(addPhoto);
      const addDoc = el('button', { class: 'addphoto' }, '📎');
      addDoc.title = 'Добавить чек, счёт или PDF';
      addDoc.addEventListener('click', pickDocs);
      photosBox.appendChild(addDoc);
    }
    async function pickPhotos() {
      const input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: 'multiple' });
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        for (const file of Array.from(input.files || [])) {
          try {
            const { blob, w, h } = await global.AL.compressImage(file, 1600);
            state.pendingPhotos.push({ blob, w, h, url: URL.createObjectURL(blob), kind: 'photo' });
          } catch (e) { toast('Не удалось обработать фото'); }
        }
        renderPhotos();
        input.remove();
      });
      input.click();
    }
    async function pickDocs() {
      const input = el('input', { type: 'file', accept: 'application/pdf,image/*', multiple: 'multiple' });
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        for (const file of Array.from(input.files || [])) {
          if (/^image\//.test(file.type)) {
            try {
              const { blob, w, h } = await global.AL.compressImage(file, 1600);
              state.pendingPhotos.push({ blob, w, h, url: URL.createObjectURL(blob), kind: 'photo' });
            } catch (e) { toast('Не удалось обработать изображение'); }
          } else {
            state.pendingPhotos.push({
              blob: file, name: file.name, mime: file.type || 'application/octet-stream',
              url: URL.createObjectURL(file), kind: 'doc'
            });
          }
        }
        renderPhotos();
        input.remove();
      });
      input.click();
    }
    renderPhotos();

    wrap.querySelectorAll('#typeChips .chip').forEach(ch => {
      ch.addEventListener('click', () => {
        type = ch.dataset.t;
        wrap.querySelectorAll('#typeChips .chip').forEach(c => c.classList.toggle('active', c === ch));
      });
    });

    wrap.querySelector('#eSave').addEventListener('click', async () => {
      const title = wrap.querySelector('#eTitle').value.trim();
      if (!title) { toast('Заполните «Кратко»'); return; }
      const btn = wrap.querySelector('#eSave');
      btn.disabled = true;
      btn.textContent = 'Подписываю…';
      try {
        await saveEvent({
          type, title,
          note: wrap.querySelector('#eNote').value.trim(),
          amount: parseFloat(wrap.querySelector('#eAmount').value) || 0,
          room: wrap.querySelector('#eRoom').value.trim(),
          counterparty: wrap.querySelector('#eCounterparty').value.trim(),
          severity: wrap.querySelector('#eSeverity').value
        }, state.pendingPhotos);
        state.pendingPhotos.forEach(p => URL.revokeObjectURL(p.url));
        state.pendingPhotos = [];
        closeModal();
        await loadAll();
        toast('Событие подписано');
      } catch (e) {
        toast('Ошибка: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Сохранить и подписать';
      }
    });

    openModal('Новое событие', wrap);
  }

  async function saveEvent(data, photos) {
    const authorId = await myAuthorId();
    const mine = state.events.filter(e => !e.authorId || e.authorId === authorId)
      .sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const prev = mine.length ? mine[mine.length - 1].hash : '';
    const seq = mine.length + 1;
    const ev = {
      id: U.uid(), journalId: state.journal.id, seq, authorId,
      type: data.type, title: data.title, note: data.note || '',
      amount: data.amount || 0, room: data.room || '', severity: data.severity || '',
      tsDevice: U.nowISO(), serverTime: null,
      photos: [], meta: data.counterparty ? { counterparty: data.counterparty } : null,
      prevHash: prev, hash: '', sig: '', tsa: null,
      createdAt: U.nowISO()
    };

    // фото и документы сохраняем до расчёта хеша (хеш включает их id и sha256)
    for (const p of photos || []) {
      const pid = U.uid();
      const sha = await U.sha256Hex(await p.blob.arrayBuffer());
      await DB.put('photos', {
        id: pid, journalId: state.journal.id, eventId: ev.id,
        blob: p.blob, mime: p.mime || 'image/jpeg', w: p.w || 0, h: p.h || 0,
        sha256: sha, ts: U.nowISO(), kind: p.kind || 'photo', name: p.name || null
      });
      ev.photos.push(pid);
    }

    // сверка времени с сервером (для контроля «отката» часов)
    try {
      const last = await DB.getSet('lastServerTime', 0);
      const srv = await Bridge.serverTime();
      if (srv) {
        ev.serverTime = new Date(srv).toISOString();
        await DB.set('lastServerTime', srv);
        if (last && srv < last - 120000) ev.meta = Object.assign({}, ev.meta || {}, { clockWarn: true });
      }
    } catch (e) { /* офлайн */ }

    const h = await U.sha256Hex(U.canonical(Object.assign({}, baseForHash(ev), { prevHash: prev })));
    ev.hash = h;
    ev.sig = await Crypto.signHex(h);
    await DB.put('events', ev);
    state.events.push(ev);

    // метка времени — не блокируем сохранение
    stampEvent(ev).catch(() => {});
    return ev;
  }

  async function stampEvent(ev) {
    try {
      const res = await TSA.stamp(ev.hash, state.tsaUrl);
      ev.tsa = res;
      await DB.put('events', ev);
      await flushQueue();
      return true;
    } catch (e) {
      const q = await DB.getSet('tsaQueue', []);
      if (!q.includes(ev.id)) { q.push(ev.id); await DB.set('tsaQueue', q); }
      return false;
    }
  }

  async function flushQueue() {
    const q = await DB.getSet('tsaQueue', []);
    if (!q.length) return { sent: 0 };
    let sent = 0;
    const left = [];
    for (const id of q) {
      const ev = await DB.get('events', id);
      if (!ev) continue;
      if (ev.tsa) { sent++; continue; }
      try {
        ev.tsa = await TSA.stamp(ev.hash, state.tsaUrl);
        await DB.put('events', ev);
        sent++;
      } catch (e) { left.push(id); }
    }
    await DB.set('tsaQueue', left);
    return { sent, left: left.length };
  }

  /* ─────────────── Приёмка / сдача ─────────────── */
  function startHandover(kind) {
    const wrap = el('div');
    const zonesUsed = (state.journal.zones && state.journal.zones.length)
      ? state.journal.zones
      : defaultZones();
    const rooms = zonesUsed.map(z => ({
      name: z.name,
      note: z.note || '',
      items: (z.items || []).map(name => ({ name, condition: 'norm', note: '', photos: [] }))
    }));
    const people = (state.journal.people || []).filter(p => p.name);
    const title = kind === 'accept' ? 'Приёмка при заселении' : 'Сдача при выезде';

    wrap.innerHTML = `
      <p class="muted small">Отметьте состояние по каждому пункту. «Норма» — без замечаний, «Дефект» — есть повреждение или неисправность, «Нет» — предмет отсутствует. Список зон задаётся на вкладке «Объект».</p>
      ${people.length ? `<div class="card"><div class="muted small">Проживают</div>${people.map(p => `<div class="kv"><span>${U.esc(p.name)}</span><b>${U.esc(p.role || '')}</b></div>`).join('')}</div>` : ''}
      <div id="roomsBox"></div>
      <label>Общий комментарий
        <textarea id="hvNote" placeholder="Например: ключи 2 шт., показания счётчиков зафиксированы"></textarea>
      </label>
      <button class="btn primary" id="hvSave">Зафиксировать и подписать</button>
    `;

    const box = wrap.querySelector('#roomsBox');
    rooms.forEach((room, ri) => {
      const node = el('div', { class: 'room' + (ri === 0 ? ' open' : '') });
      node.innerHTML = `
        <div class="room-head"><span>${U.esc(room.name)}</span><span class="muted small">${room.items.length} п.</span></div>
        <div class="room-body"></div>
      `;
      const body = node.querySelector('.room-body');
      node.querySelector('.room-head').addEventListener('click', () => node.classList.toggle('open'));
      room.items.forEach((item, ii) => {
        const it = el('div', { class: 'item' });
        it.innerHTML = `
          <div class="item-name">${U.esc(item.name)}</div>
          <div class="seg">
            <button data-v="norm" class="on">Норма</button>
            <button data-v="defect">Дефект</button>
            <button data-v="absent">Нет</button>
          </div>
          <input placeholder="Замечание (необязательно)">
          <div class="item-shots"></div>
          <button class="shotbtn" type="button">📷 Фото</button>
        `;
        const seg = it.querySelectorAll('.seg button');
        const noteInput = it.querySelector('input');
        seg.forEach(b => b.addEventListener('click', () => {
          seg.forEach(x => x.classList.remove('on'));
          b.classList.add('on');
          item.condition = b.dataset.v;
          if (item.condition !== 'norm') noteInput.focus();
        }));
        noteInput.addEventListener('input', () => { item.note = noteInput.value; });

        const shots = it.querySelector('.item-shots');
        const shotBtn = it.querySelector('.shotbtn');
        const urls = {};
        function renderShots() {
          shots.innerHTML = '';
          (item.photos || []).forEach(pid => {
            const cell = el('div', { class: 'shot' });
            cell.innerHTML = `<img src="${urls[pid] || ''}" alt="">`;
            cell.title = 'Нажмите, чтобы убрать';
            cell.addEventListener('click', async () => {
              if (!confirm('Убрать это фото?')) return;
              item.photos = item.photos.filter(x => x !== pid);
              try { await DB.del('photos', pid); } catch (e) { }
              renderShots();
            });
            shots.appendChild(cell);
          });
          shotBtn.textContent = (item.photos && item.photos.length) ? '📷 Ещё фото' : '📷 Фото';
        }
        shotBtn.addEventListener('click', () => {
          const input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: 'multiple' });
          input.style.display = 'none';
          document.body.appendChild(input);
          input.addEventListener('change', async () => {
            for (const file of Array.from(input.files || [])) {
              try {
                const { blob, w, h } = await global.AL.compressImage(file, 1600);
                const pid = U.uid();
                const sha = await U.sha256Hex(await blob.arrayBuffer());
                await DB.put('photos', {
                  id: pid, journalId: state.journal.id, eventId: null,
                  blob: blob, mime: 'image/jpeg', w: w, h: h, sha256: sha,
                  ts: U.nowISO(), kind: 'photo', name: file.name || null
                });
                item.photos.push(pid);
                urls[pid] = URL.createObjectURL(blob);
                renderShots();
              } catch (e) { toast('Не удалось обработать фото'); }
            }
            input.remove();
          });
          input.click();
        });
        renderShots();
        body.appendChild(it);
      });
      box.appendChild(node);
    });

    wrap.querySelector('#hvSave').addEventListener('click', async () => {
      const btn = wrap.querySelector('#hvSave');
      btn.disabled = true;
      btn.textContent = 'Подписываю…';
      const meta = {
        keyCount: null,
        note: wrap.querySelector('#hvNote').value.trim(),
        rooms: rooms,
        people: people.map(p => ({ name: p.name, role: p.role || '' })),
        device: Bridge.deviceInfo()
      };
      const prev = state.events.length ? state.events[state.events.length - 1].hash : '';
      const hv = {
        id: U.uid(), journalId: state.journal.id, kind,
        title, tsDevice: U.nowISO(), meta,
        prevHash: prev, hash: '', sig: '', tsa: null, createdAt: U.nowISO()
      };
      const h = await U.sha256Hex(U.canonical({
        journalId: hv.journalId, kind, tsDevice: hv.tsDevice, meta, prevHash: prev
      }));
      hv.hash = h;
      hv.sig = await Crypto.signHex(h);
      await DB.put('handovers', hv);

      // создаём событие в журнале для наглядности
      const defects = rooms.reduce((n, r) => n + r.items.filter(i => i.condition !== 'norm').length, 0);
      await saveEvent({
        type: kind === 'accept' ? 'notice' : 'note',
        title: title + (defects ? ` · замечаний: ${defects}` : ' · без замечаний'),
        note: meta.note, amount: 0, room: '', severity: ''
      }, []);

      closeModal();
      await loadAll();
      renderHandovers();
      toast('Приёмка зафиксирована');
    });

    openModal(title, wrap);
  }

  function renderHandovers() {
    const box = $('#handoverBody');
    if (!box) return;
    box.innerHTML = '';
    if (!state.handovers.length) {
      box.appendChild(el('div', { class: 'empty' }, '<div class="empty-ico">✅</div><div>Пока нет ни одной приёмки или сдачи.</div>'));
      return;
    }
    state.handovers.slice().reverse().forEach(hv => {
      const defects = (hv.meta.rooms || []).reduce((n, r) => n + r.items.filter(i => i.condition !== 'norm').length, 0);
      const card = el('div', { class: 'card' });
      card.innerHTML = `
        <div class="kv"><span>${hv.kind === 'accept' ? 'Приёмка' : 'Сдача'}</span><b>${U.fmtDateTime(hv.tsDevice)}</b></div>
        <div class="kv"><span>Замечаний</span><b>${defects}</b></div>
        <div class="kv"><span>Хеш</span><b class="mono small">${hv.hash.slice(0, 16)}…</b></div>
      `;
      card.addEventListener('click', () => handoverDetails(hv));
      box.appendChild(card);
    });
  }

  function handoverDetails(hv) {
    const wrap = el('div');
    const rooms = hv.meta.rooms || [];
    wrap.innerHTML = rooms.map(r => `
      <div class="card">
        <b>${U.esc(r.name)}</b>
        ${r.items.map(i => `<div class="kv"><span>${U.esc(i.name)}</span><b>${i.condition === 'norm' ? 'норма' : i.condition === 'defect' ? 'дефект' : 'нет'}${i.note ? ' · ' + U.esc(i.note) : ''}</b></div>`).join('')}
      </div>
    `).join('') + `
      <div class="card">
        <div class="muted small">Хеш акта</div>
        <div class="mono small" style="word-break:break-all">${hv.hash}</div>
        <div class="muted small" style="margin-top:8px">Подпись</div>
        <div class="mono small" style="word-break:break-all">${hv.sig}</div>
      </div>
    `;
    openModal(hv.title, wrap);
  }

  /* ─────────────── Отчёт ─────────────── */
  async function renderStats() {
    $('#stEvents').textContent = state.events.length;
    $('#stPhotos').textContent = Object.keys(state.photos).length;
    const sum = state.events.filter(e => e.type === 'improvement').reduce((n, e) => n + (Number(e.amount) || 0), 0)
      + state.events.filter(e => e.type === 'defect').reduce((n, e) => n + (Number(e.amount) || 0), 0);
    $('#stSum').textContent = U.money(sum);
    const res = await verifyChain();
    $('#stRoot').textContent = res.ok && res.root ? res.root.slice(0, 24) + '…' : '—';
    const stamped = state.events.filter(e => e.tsa).length;
    $('#stTsa').textContent = stamped + ' из ' + state.events.length;
    const info = Bridge.deviceInfo();
    $('#devId').textContent = (info.model || 'устройство');
    const kp = await Crypto.ensureKeys();
    $('#keyInfo').textContent = kp.pubHex.slice(0, 16) + '…';
    $('#chainInfo').textContent = res.ok ? 'цела · ' + state.events.length + ' событий' : 'нарушена';
    $('#fTsa').value = state.tsaUrl;
  }

  function buildReportHtml(opts) {
    opts = opts || {};
    const j = state.journal;
    const evs = state.events.slice().sort((a, b) => a.seq - b.seq);
    /* если журнал начат не с первого дня аренды — в отчёте это должно быть видно */
    const startedLater = !!(j.start && evs.length &&
      new Date(evs[0].tsDevice) > new Date(new Date(j.start).getTime() + 86400000));
    const photos = state.photos;
    const rows = evs.map(ev => {
      const t = TYPES[ev.type] || TYPES.note;
      const atts = (ev.photos || []).map(id => photos[id]).filter(Boolean);
      const imgs = atts.filter(a => (a.kind || 'photo') === 'photo');
      const docs = atts.filter(a => a.kind === 'doc');
      const pics = imgs
        .map(p => `<div style="display:inline-block;margin:3px;text-align:center"><img src="${state.photoUrl[p.id]}" style="width:150px;height:120px;object-fit:cover;border:1px solid #ccc"><div style="font-size:8pt;color:#666">${p.sha256.slice(0, 12)}</div></div>`).join('');
      const docList = docs
        .map(d => `<div style="font-size:8pt;color:#333">📎 ${U.esc(d.name || 'документ')} · SHA-256 ${d.sha256.slice(0, 16)}…</div>`).join('');
      const cp = (ev.meta && ev.meta.counterparty) ? `<br><small>${U.esc(ev.meta.counterparty)}</small>` : '';
      return `<tr>
        <td style="text-align:center">${ev.seq}</td>
        <td style="white-space:nowrap">${U.fmtDateTime(ev.tsDevice)}</td>
        <td>${ev.tsa ? U.fmtDateTime(ev.tsa.time) : '—'}</td>
        <td>${t.label}${ev.room ? '<br><small>' + U.esc(ev.room) + '</small>' : ''}</td>
        <td><b>${U.esc(ev.title || '')}</b>${cp}${ev.note ? '<br><span style="color:#444">' + U.esc(ev.note) + '</span>' : ''}${pics ? '<div>' + pics + '</div>' : ''}${docList}</td>
        <td style="text-align:right;white-space:nowrap">${ev.amount ? U.money(ev.amount) : '—'}</td>
        <td style="font-size:7pt;word-break:break-all">${ev.hash}<br><span style="color:#888">${ev.sig.slice(0, 24)}…</span></td>
      </tr>`;
    }).join('');

    /* чеки и документы: отдельный раздел с итогом */
    const receiptEvs = evs.filter(e =>
      e.type === 'receipt' ||
      (e.photos || []).some(pid => photos[pid] && photos[pid].kind === 'doc'));
    const receiptSum = receiptEvs.reduce((n, e) => n + (Number(e.amount) || 0), 0);
    const receiptRows = receiptEvs.map(e => {
      const docs = (e.photos || []).map(id => photos[id]).filter(p => p && p.kind === 'doc');
      const names = docs.map(d => U.esc(d.name || 'документ')).join('<br>') || '—';
      const sums = docs.map(d => (d.sha256 || '').slice(0, 12)).join('<br>') || '—';
      return `<tr>
        <td style="text-align:center">${e.seq}</td>
        <td style="white-space:nowrap">${U.fmtDateTime(e.tsDevice)}</td>
        <td>${U.esc((e.meta && e.meta.counterparty) || '—')}</td>
        <td>${U.esc(e.title || '')}</td>
        <td style="text-align:right;white-space:nowrap">${e.amount ? U.money(e.amount) : '—'}</td>
        <td style="font-size:8pt">${names}</td>
        <td style="font-size:7pt;color:#666">${sums}</td>
      </tr>`;
    }).join('');

    const receiptBlock = receiptEvs.length ? `
      <h2>Чеки и подтверждающие документы</h2>
      <table>
        <thead><tr><th style="width:6%">№</th><th style="width:14%">Дата</th><th style="width:18%">Контрагент</th><th>Назначение</th><th style="width:11%">Сумма</th><th style="width:16%">Файл</th><th style="width:12%">SHA-256</th></tr></thead>
        <tbody>${receiptRows}</tbody>
        <tfoot><tr><td colspan="4" style="text-align:right"><b>Итого</b></td><td style="text-align:right"><b>${U.money(receiptSum)}</b></td><td colspan="2"></td></tr></tfoot>
      </table>` : '';

    const hvHtml = state.handovers.map(hv => `
      <h3>${hv.kind === 'accept' ? 'Акт приёмки' : 'Акт сдачи'} — ${U.fmtDateTime(hv.tsDevice)}</h3>
      ${(hv.meta.people || []).length ? `<p style="font-size:9pt;margin:1mm 0 2mm">Проживают: ${hv.meta.people.map(p => U.esc(p.name) + (p.role ? ' (' + U.esc(p.role) + ')' : '')).join(', ')}</p>` : ''}
      <table class="t2">
        ${(hv.meta.rooms || []).map(r => `<tr><td colspan="3" style="background:#f2f2f2"><b>${U.esc(r.name)}</b></td></tr>` +
      r.items.map(i => `<tr><td>${U.esc(i.name)}</td><td>${i.condition === 'norm' ? 'норма' : i.condition === 'defect' ? 'дефект' : 'отсутствует'}</td><td>${U.esc(i.note || '')}${(i.photos || []).length ? ' 📷' + i.photos.length : ''}</td></tr>`).join('')).join('')}
      </table>
      <p style="font-size:8pt;color:#555">Хеш акта: ${hv.hash}<br>Подпись: ${hv.sig}</p>
    `).join('');

    return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
    <title>Журнал аренды — ${U.esc(j.title || '')}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font: 10pt/1.4 "Times New Roman", serif; color: #000; }
      h1 { font-size: 16pt; margin: 0 0 4mm; }
      h2 { font-size: 12pt; margin: 6mm 0 2mm; border-bottom: 1px solid #999; padding-bottom: 1mm; }
      h3 { font-size: 11pt; margin: 5mm 0 2mm; }
      table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
      th, td { border: 1px solid #999; padding: 2mm; vertical-align: top; }
      th { background: #eee; }
      .meta { margin-bottom: 4mm; font-size: 9.5pt; }
      .meta div { margin: 1mm 0; }
      .hash { font-family: monospace; font-size: 7.5pt; word-break: break-all; }
      .note { font-size: 8.5pt; color: #333; margin-top: 3mm; }
      .sig { margin-top: 12mm; display: flex; justify-content: space-between; font-size: 9pt; }
      .sig div { width: 45%; border-top: 1px solid #000; padding-top: 2mm; text-align: center; }
    </style></head><body>
    <h1>Журнал аренды и зафиксированных фактов</h1>
    <div class="meta">
      <div><b>Объект:</b> ${U.esc(j.address || j.title || '—')}</div>
      <div><b>Стороны:</b> арендатор ${U.esc(j.tenant || '—')} · арендодатель ${U.esc(j.landlord || '—')}</div>
      <div><b>Период аренды:</b> ${U.fmtDate(j.start)} — ${U.fmtDate(j.end)} ${j.rent ? '· плата ' + U.money(j.rent) + '/мес' : ''} ${j.deposit ? '· залог ' + U.money(j.deposit) : ''}</div>
      <div><b>Сформировано:</b> ${U.fmtDateTime(U.nowISO())}</div>
      <div><b>Событий:</b> ${evs.length} · подтверждено временем: ${evs.filter(e => e.tsa).length}</div>
      ${evs.length ? `<div><b>Записи ведутся с:</b> ${U.fmtDateTime(evs[0].tsDevice)}${startedLater ? ' — за более ранний период записей нет' : ''}</div>` : ''}
      ${(j.contract || []).length ? `<div><b>Договор аренды:</b> ${j.contract.length} стр. · копии в папке contract/</div>` : ''}
    </div>

    <h2>Зафиксированные события</h2>
    <table>
      <thead><tr><th style="width:5%">№</th><th style="width:13%">Время устройства</th><th style="width:13%">Подтверждено</th><th style="width:11%">Тип</th><th>Содержание</th><th style="width:10%">Сумма</th><th style="width:16%">SHA-256 / подпись</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#777">События отсутствуют</td></tr>'}</tbody>
    </table>

    ${receiptBlock}

    ${hvHtml ? '<h2>Приёмка и сдача объекта</h2>' + hvHtml : ''}

    <h2>Контроль целостности</h2>
    <p class="note">
      Каждое событие связано с предыдущим хешем SHA-256, образуя непрерывную цепочку. Любое изменение или удаление
      записи нарушает цепочку и делает контрольный корневой хеш недействительным. События подписаны ключом устройства
      (ECDSA P-256), созданным в защищённом хранилище приложения и не подлежащим экспорту.
    </p>
    <p class="hash">Корень цепочки: ${opts.root || '—'}<br>
    Отпечаток ключа: ${opts.keyHex || '—'}<br>
    Метки времени: RFC 3161, сервер ${U.esc(state.tsaUrl)}</p>
    <p class="note">
      Как проверить: 1) пересчитать SHA-256 каждого события по рекомендованному порядке и сверить с таблицей;
      2) проверить подпись открытым ключом; 3) проверить токены .tsr на сервере меток времени.
      Порядок и состав данных описаны в файле manifest.json пакета доказательств.
    </p>

    <div class="sig">
      <div>Арендатор<br><br>${U.esc(j.tenant || '________________')}</div>
      <div>Арендодатель<br><br>${U.esc(j.landlord || '________________')}</div>
    </div>
    </body></html>`;
  }

  /* готовит скрытую область печати: только её увидит системный диалог печати */
  function preparePrintArea(fullHtml) {
    let doc;
    try { doc = new DOMParser().parseFromString(fullHtml, 'text/html'); }
    catch (e) { doc = null; }
    const css = doc && doc.querySelector('style') ? doc.querySelector('style').textContent : '';
    const bodyHtml = doc && doc.body ? doc.body.innerHTML : fullHtml;

    let area = document.getElementById('printArea');
    if (!area) {
      area = el('div', { id: 'printArea' });
      document.body.appendChild(area);
    }
    area.innerHTML = '<style>' + css + '</style>' + bodyHtml;

    let st = document.getElementById('printStyle');
    if (!st) { st = el('style', { id: 'printStyle' }); document.head.appendChild(st); }
    st.textContent =
      '@media print{body> *:not(#printArea){display:none !important}' +
      '#printArea{display:block !important;background:#fff;color:#000;padding:0;' +
      'font:10pt/1.4 "Times New Roman",serif}}';
    return area;
  }

  /* автономный верификатор пакета — тот же, что кладётся в ZIP */
  function openVerifier() {
    const wrap = el('div');
    const frame = el('iframe', {
      src: 'verify.html',
      style: 'width:100%;height:66vh;border:1px solid #2a323d;border-radius:12px;background:#0e1116'
    });
    wrap.appendChild(frame);
    wrap.appendChild(el('p', { class: 'muted small' },
      'Перетащите архив .zip в окно проверки. Всё считается на устройстве, данные никуда не отправляются.'));
    openModal('Проверка пакета', wrap);
  }

  /* отчёт + договор одним PDF: печать объединённого документа */
  async function buildReportWithContract() {
    const res = await verifyChain();
    const kp = await Crypto.ensureKeys();
    let html = buildReportHtml({ root: res.ok ? res.root : 'НАРУШЕНА', keyHex: kp.pubHex });
    const ids = contractIds();
    if (!ids.length) return html;
    let pages = '';
    let counter = 0;
    for (const pid of ids) {
      const p = state.photos[pid];
      if (!p) continue;
      if (!/^image\//.test(p.mime || '')) {
        pages += '<p style="font-size:9pt">Приложенный файл: ' + U.esc(p.name || 'документ') +
          ' — в пакете доказательств (.zip)</p>';
        continue;
      }
      const b64 = await blobToB64(p.blob);
      counter++;
      pages += '<div style="page-break-inside:avoid;margin-bottom:4mm">' +
        '<img src="data:' + (p.mime || 'image/jpeg') + ';base64,' + b64 + '" style="width:100%;display:block">' +
        '<div style="font-size:8pt;color:#555;text-align:center">стр. ' + counter + '</div></div>';
    }
    if (!pages) return html;
    return html.replace('</body>',
      '<div style="page-break-before:always"></div><h2>Приложение. Договор аренды</h2>' +
      '<p style="font-size:8pt;color:#555">Страниц: ' + counter + '</p>' + pages + '</body>');
  }

  async function printWithContract() {
    const html = await buildReportWithContract();
    preparePrintArea(html);
    Bridge.print();
    toast('В окне печати выберите «Сохранить как PDF»');
  }

  async function showReport(autoPrint) {
    const res = await verifyChain();
    const kp = await Crypto.ensureKeys();
    const html = buildReportHtml({ root: res.ok ? res.root : 'НАРУШЕНА', keyHex: kp.pubHex });
    preparePrintArea(html);

    const frame = el('iframe', {
      style: 'width:100%;height:62vh;border:1px solid #2a323d;border-radius:12px;background:#fff'
    });
    const wrap = el('div');
    wrap.appendChild(frame);
    const actions = el('div', { class: 'grid2', style: 'margin-top:10px' });
    const printBtn = el('button', { class: 'btn primary' }, 'Печать / PDF');
    printBtn.addEventListener('click', () => {
      preparePrintArea(html);
      Bridge.print();
    });
    const saveBtn = el('button', { class: 'btn' }, 'Сохранить HTML');
    saveBtn.addEventListener('click', async () => {
      const r = await Bridge.saveFile('Журнал-' + U.fmtDate(U.nowISO()).replace(/\./g, '-') + '.html',
        btoa(unescape(encodeURIComponent(html))), 'text/html');
      toast(r.ok ? 'Файл сохранён: ' + (r.path || '') : 'Ошибка: ' + r.error);
    });
    actions.appendChild(printBtn);
    actions.appendChild(saveBtn);
    wrap.appendChild(actions);
    openModal('Отчёт', wrap);
    frame.srcdoc = html;
    if (autoPrint) setTimeout(() => { preparePrintArea(html); Bridge.print(); }, 600);
  }

  async function buildEvidencePackage() {
    const res = await verifyChain();
    const kp = await Crypto.ensureKeys();
    const now = U.nowISO();
    const stamp = U.fmtDate(now).split('.').reverse().join('-');
    const j = state.journal;
    const files = [];
    const nameFor = (p) => {
      if (p.kind === 'doc') {
        const safe = String(p.name || ('doc-' + p.id)).replace(/[^\w.\-]+/g, '_').slice(-60);
        return 'docs/' + safe;
      }
      return 'photos/' + p.id + '.jpg';
    };
    const manifest = { app: 'АрендаЛог 1.0', createdAt: now, journalId: j.id, authorId: await myAuthorId(), rootHash: res.ok ? res.root : null, keyFingerprint: kp.pubHex, chainOk: res.ok, files: [] };
    try { manifest.publicKeyJwk = await Crypto.publicJwk(); } catch (e) { }

    const html = buildReportHtml({ root: res.ok ? res.root : 'НАРУШЕНА', keyHex: kp.pubHex });
    const htmlBytes = new TextEncoder().encode(html);
    files.push({ name: 'report.html', bytes: htmlBytes });
    manifest.files.push({ name: 'report.html', sha256: await U.sha256Hex(htmlBytes) });

    const data = {
      format: 'arendalog/1', exportedAt: now, journal: j,
      events: state.events, handovers: state.handovers,
      photos: state.events.flatMap(e => (e.photos || []).map(pid => {
        const p = state.photos[pid];
        return p ? {
          id: p.id, eventId: e.id, sha256: p.sha256, mime: p.mime,
          kind: p.kind || 'photo', name: p.name || null, file: nameFor(p)
        } : null;
      })).filter(Boolean),
      contract: (j.contract || []).map(pid => { const p = state.photos[pid]; return p ? { id: p.id, kind: p.kind || 'photo', name: p.name || null, sha256: p.sha256 } : null; }).filter(Boolean),
      integrity: { rootHash: manifest.rootHash, keyFingerprint: kp.pubHex, algorithm: 'SHA-256 + ECDSA P-256', timestamps: 'RFC 3161' }
    };
    const dataBytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
    files.push({ name: 'journal.json', bytes: dataBytes });
    manifest.files.push({ name: 'journal.json', sha256: await U.sha256Hex(dataBytes) });

    for (const ev of state.events) {
      for (const pid of ev.photos || []) {
        const p = state.photos[pid];
        if (!p) continue;
        const bytes = new Uint8Array(await p.blob.arrayBuffer());
        const name = nameFor(p);
        files.push({ name, bytes });
        manifest.files.push({ name, sha256: await U.sha256Hex(bytes) });
      }
      if (ev.tsa && ev.tsa.token) {
        const bytes = U.unb64(ev.tsa.token);
        const name = 'timestamps/' + ev.id + '.tsr';
        files.push({ name, bytes });
        manifest.files.push({ name, sha256: await U.sha256Hex(bytes) });
      }
    }

    // договор аренды — отдельной папкой пакета
    for (const pid of (j.contract || [])) {
      const p = state.photos[pid];
      if (!p) continue;
      const bytes = new Uint8Array(await p.blob.arrayBuffer());
      const base = p.kind === 'doc'
        ? String(p.name || ('договор-' + p.id)).replace(/[^\w.\-]+/g, '_').slice(-60)
        : p.id + '.jpg';
      const name = 'contract/' + base;
      files.push({ name, bytes });
      manifest.files.push({ name, sha256: await U.sha256Hex(bytes) });
    }

    const readme = `ПАКЕТ ДОКАЗАТЕЛЬСТВ «АРЕНДАЛОГ»
Сформирован: ${now}
Объект: ${j.address || j.title}
Арендатор: ${j.tenant || '—'}
Арендодатель: ${j.landlord || '—'}

СОСТАВ
  report.html     — печатный отчёт для суда
  journal.json    — все события, акты, описания вложений
  manifest.json   — SHA-256 каждого файла, корневой хеш, открытый ключ
  photos/         — фотографии
  docs/           — чеки, счета, PDF-документы
  timestamps/     — токены меток времени RFC 3161
  verify.html     — автономная страница проверки (открывается в браузере)

КАК ПРОВЕРИТЬ (без установки приложения)
  1. Откройте verify.html в любом браузере и перетащите в него этот архив.
  2. Страница сама пересчитает SHA-256 всех файлов, проверит непрерывность
     хеш-цепочки, электронные подписи и соответствие токенов меток времени.
  3. Результат: «Пакет подлинный и не изменён» либо список расхождений.

  Проверка вручную:
  • SHA-256 файлов должны совпасть с manifest.json;
  • каждое событие в journal.json содержит prevHash и hash;
  • подписи проверяются открытым ключом с отпечатком ${kp.pubHex};
  • токены из timestamps/ проверяются на сервере меток времени (RFC 3161).
`;
    const readmeBytes = new TextEncoder().encode(readme);
    files.push({ name: 'README.txt', bytes: readmeBytes });
    manifest.files.push({ name: 'README.txt', sha256: await U.sha256Hex(readmeBytes) });

    // автономный верификатор — чтобы пакет можно было проверить без приложения
    let verifyHtml = global.VERIFIER_HTML || null;
    if (!verifyHtml) {
      try { const rr = await fetch('verify.html'); if (rr.ok) verifyHtml = await rr.text(); } catch (e) { }
    }
    if (verifyHtml) {
      const vb = new TextEncoder().encode(verifyHtml);
      files.push({ name: 'verify.html', bytes: vb });
      manifest.files.push({ name: 'verify.html', sha256: await U.sha256Hex(vb) });
    }

    const manBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    files.push({ name: 'manifest.json', bytes: manBytes });

    const blob = Zip.build(files);
    return { blob, name: `АрендаЛог-${stamp}.zip`, manifest };
  }

  async function exportZip() {
    const pack = await buildEvidencePackage();
    const b64 = await blobToB64(pack.blob);
    const r = await Bridge.saveFile(pack.name, b64, 'application/zip');
    toast(r.ok ? 'Пакет сохранён: ' + (r.path || r.name || 'в загрузки') : 'Ошибка: ' + r.error);
  }

  function blobToB64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function exportBackup(invite) {
    const kp = await Crypto.ensureKeys();
    const pubJwk = await Crypto.publicJwk();
    const photos = [];
    for (const id in state.photos) {
      const p = state.photos[id];
      photos.push({ id: p.id, eventId: p.eventId, mime: p.mime, sha256: p.sha256, b64: await blobToB64(p.blob) });
    }
    const res = await verifyChain();
    const pack = {
      format: 'arendalog/1', kind: invite ? 'invite' : 'backup',
      exportedAt: U.nowISO(), journal: state.journal,
      events: state.events, handovers: state.handovers, photos,
      integrity: { rootHash: res.root, keyFingerprint: kp.pubHex },
      pubKeyJwk: pubJwk,
      signerPubHex: state.journal.pubHex || kp.pubHex
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(pack))));
    const name = (invite ? 'Приглашение-арендодателю-' : 'АрендаЛог-копия-') + U.fmtDate(U.nowISO()).replace(/\./g, '-') + '.alog';
    const r = await Bridge.saveFile(name, b64, 'application/json');
    if (r.ok && !invite) {
      await DB.set('lastBackupAt', Date.now());
      refreshBackupBanner();
    }
    toast(r.ok ? 'Файл сохранён: ' + (r.path || name) : 'Ошибка: ' + r.error);
  }

  async function importBackup() {
    const input = el('input', { type: 'file', accept: '.alog,application/json' });
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = (input.files || [])[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        const pack = JSON.parse(text);
        if (pack.format !== 'arendalog/1') throw new Error('неизвестный формат');
        if (!confirm(`Импортировать журнал «${pack.journal.title || ''}»?\nСобытий: ${(pack.events || []).length}. Текущие данные будут заменены.`)) return;
        await DB.clearAll();
        if (pack.pubKeyJwk) await DB.set('viewerKey', pack.pubKeyJwk);
        if (pack.journal && !pack.journal.pubHex) pack.journal.pubHex = pack.signerPubHex || null;
        await DB.put('journals', pack.journal);
        await DB.set('activeJournal', pack.journal.id);
        for (const ev of pack.events || []) await DB.put('events', ev);
        for (const hv of pack.handovers || []) await DB.put('handovers', hv);
        for (const p of pack.photos || []) {
          const bytes = U.unb64(p.b64);
          await DB.put('photos', {
            id: p.id, journalId: pack.journal.id, eventId: p.eventId,
            blob: new Blob([bytes], { type: p.mime || 'image/jpeg' }),
            mime: p.mime, sha256: p.sha256, ts: U.nowISO()
          });
        }
        await loadAll();
        showTab('home');
        toast(pack.kind === 'invite' ? 'Открыт журнал в режиме просмотра' : 'Журнал восстановлен');
      } catch (e) {
        toast('Не удалось импортировать: ' + e.message);
      }
    });
    input.click();
  }

  /* ─────────────── Объект ─────────────── */
  /* ─────────────── Зоны и комнаты ─────────────── */
  function renderZones() {
    const box = $('#zonesList');
    if (!box) return;
    const zones = state.journal.zones || [];
    box.innerHTML = '';
    if (!zones.length) {
      box.appendChild(el('div', { class: 'muted small' }, 'Зон пока нет — добавьте вручную или возьмите шаблон.'));
    }
    zones.forEach(z => {
      const row = el('div', { class: 'kv', style: 'cursor:pointer' });
      row.innerHTML = `<span>${U.esc(z.name)}${z.note ? ` <small class="muted">· ${U.esc(z.note)}</small>` : ''}</span>` +
        `<b class="small">${(z.items || []).length} п. ✎</b>`;
      row.addEventListener('click', () => editZone(z.id));
      box.appendChild(row);
    });
  }

  function editZone(id) {
    const zones = state.journal.zones || [];
    const existing = id ? zones.find(z => z.id === id) : null;
    const z = existing || { id: U.uid(), name: '', note: '', items: [] };
    const wrap = el('div');
    wrap.innerHTML = `
      <label>Название зоны
        <input id="zName" value="${U.esc(z.name)}" placeholder="Мангальная зона">
      </label>
      <label>Описание (необязательно)
        <input id="zNote" value="${U.esc(z.note || '')}" placeholder="Кратко: где находится, на что смотреть">
      </label>
      <label>Пункты для приёмки — по одному в строке
        <textarea id="zItems" style="min-height:150px">${U.esc((z.items || []).join('\n'))}</textarea>
      </label>
      <button class="btn primary" id="zSave">Сохранить</button>
      ${existing ? '<button class="btn danger" id="zDel" style="margin-top:8px">Удалить зону</button>' : ''}
    `;
    wrap.querySelector('#zSave').addEventListener('click', async () => {
      const name = wrap.querySelector('#zName').value.trim();
      if (!name) { toast('Введите название зоны'); return; }
      const note = wrap.querySelector('#zNote').value.trim();
      const items = wrap.querySelector('#zItems').value
        .split('\n').map(s => s.trim()).filter(Boolean);
      const list = state.journal.zones || [];
      if (existing) {
        existing.name = name; existing.note = note; existing.items = items;
      } else {
        list.push({ id: z.id, name, note, items });
        state.journal.zones = list;
      }
      await saveJournal();
      closeModal();
      renderZones();
      toast('Зона сохранена');
    });
    const del = wrap.querySelector('#zDel');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Удалить зону «' + z.name + '»? Записи приёмки уже сохранены и не изменятся.')) return;
      state.journal.zones = (state.journal.zones || []).filter(x => x.id !== z.id);
      await saveJournal();
      closeModal();
      renderZones();
      toast('Зона удалена');
    });
    openModal(existing ? 'Изменить зону' : 'Новая зона', wrap);
  }

  function zoneTemplates() {
    const wrap = el('div');
    wrap.innerHTML =
      Object.keys(ZONE_TEMPLATES).map(k => {
        const t = ZONE_TEMPLATES[k];
        return `<button class="tile" data-tpl="${k}" style="width:100%;margin-bottom:8px">${U.esc(t.title)}<small>${U.esc(t.desc)}</small></button>`;
      }).join('') +
      '<p class="muted small">Текущий список зон будет заменён. Уже подписанные акты приёмки не изменяются.</p>';
    wrap.querySelectorAll('[data-tpl]').forEach(b => {
      b.addEventListener('click', async () => {
        const t = ZONE_TEMPLATES[b.dataset.tpl];
        if (!confirm(`Заменить список зон шаблоном «${t.title}»?`)) return;
        state.journal.zones = t.zones.map(z => ({ id: U.uid(), name: z.name, note: '', items: z.items.slice() }));
        await saveJournal();
        closeModal();
        renderZones();
        toast('Шаблон применён: ' + t.title);
      });
    });
    openModal('Шаблоны зон', wrap);
  }

  /* ─────────────── Проживающие ─────────────── */
  function renderPeople() {
    const box = $('#peopleList');
    if (!box) return;
    const people = state.journal.people || [];
    box.innerHTML = '';
    if (!people.length) {
      box.appendChild(el('div', { class: 'muted small' }, 'Пока никто не указан. Добавьте себя и тех, кто живёт с вами.'));
    }
    people.forEach(p => {
      const row = el('div', { class: 'kv', style: 'cursor:pointer' });
      row.innerHTML = `<span>${U.esc(p.name || 'без имени')}</span><b class="small">${U.esc(p.role || '')} ✎</b>`;
      row.addEventListener('click', () => editPerson(p.id));
      box.appendChild(row);
    });
  }

  function editPerson(id) {
    const people = state.journal.people || [];
    const existing = id ? people.find(p => p.id === id) : null;
    const p = existing || { id: U.uid(), name: '', role: 'арендатор' };
    const wrap = el('div');
    wrap.innerHTML = `
      <label>Имя
        <input id="pName" value="${U.esc(p.name)}" placeholder="Иванова Мария">
      </label>
      <label>Роль в проживании
        <select id="pRole">${ROLES.map(r => `<option ${r === p.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
      </label>
      <label>Телефон (необязательно)
        <input id="pPhone" type="tel" value="${U.esc(p.phone || '')}" placeholder="+7 …">
      </label>
      <button class="btn primary" id="pSave">Сохранить</button>
      ${existing ? '<button class="btn danger" id="pDel" style="margin-top:8px">Удалить</button>' : ''}
    `;
    wrap.querySelector('#pSave').addEventListener('click', async () => {
      const name = wrap.querySelector('#pName').value.trim();
      if (!name) { toast('Введите имя'); return; }
      const role = wrap.querySelector('#pRole').value;
      const phone = wrap.querySelector('#pPhone').value.trim();
      if (existing) {
        existing.name = name; existing.role = role; existing.phone = phone;
      } else {
        people.push({ id: p.id, name, role, phone });
        state.journal.people = people;
      }
      await saveJournal();
      closeModal();
      renderPeople();
      toast('Сохранено');
    });
    const del = wrap.querySelector('#pDel');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Удалить «' + p.name + '» из списка?')) return;
      state.journal.people = (state.journal.people || []).filter(x => x.id !== p.id);
      await saveJournal();
      closeModal();
      renderPeople();
      toast('Удалено');
    });
    openModal(existing ? 'Изменить данные' : 'Новый проживающий', wrap);
  }

  /* карточка версии: текущая сборка и время последней проверки */
  async function refreshVersionCard() {
    const node = $('#verInfo');
    if (!node || !global.Update) return;
    let txt = global.Update.current;
    try {
      const at = await DB.getSet('updateCheckedAt', null);
      if (at) {
        const d = new Date(at);
        const dd = String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
        const tt = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        txt += ' · проверено ' + dd + ' ' + tt;
      }
    } catch (e) { }
    node.textContent = txt;
  }

  /* ─────────────── Помощь: частые вопросы и условия ─────────────── */
  const FAQ_ITEMS = [
    ['Где хранятся мои записи?',
      'Только в памяти приложения на этом телефоне. Они никуда не уходят, пока вы сами не сохраните копию или не подключите свой сервер.'],
    ['Что будет, если телефон потеряется или его украдут?',
      'Записи пропадут вместе с телефоном, если вы заранее не сохранили копию. Кнопка «Сохранить копию» создаёт файл — отправьте его себе в облако или мессенджер. На новом телефоне откройте этот файл, и всё вернётся.'],
    ['Google восстановит данные при смене телефона?',
      'Нет. Google может вернуть список приложений, но не содержимое журнала. Переносить нужно файлом копии.'],
    ['Что такое «подтверждение времени»?',
      'Независимый сервер времени ставит отметку, что запись существовала именно в этот момент. Благодаря этому нельзя утверждать, что вы дописали что-то задним числом.'],
    ['Нужен ли интернет?',
      'Нет. Записи, фото и подписи делаются без сети. Подтверждение времени добавится само, когда сеть появится.'],
    ['Нужен ли сервер?',
      'Нет. Приложение полностью работает на телефоне. Сервер нужен только для совместной работы в реальном времени — это необязательно.'],
    ['Как показать записи арендодателю?',
      'В разделе «Отчёт» есть «Приглашение арендодателю» — файл, который он откроет в приложении в режиме просмотра. Или отчёт в PDF.'],
    ['Можно ли удалить запись?',
      'Да, но цепочка пересчитается, и прежний корневой хеш перестанет совпадать с тем, что вы кому-то отправляли. Если запись ошибочна — лучше не удалять, а добавить уточнение.'],
    ['Где фотографии? Их нет в галерее.',
      'Фото хранятся внутри приложения и попадают в копию и в пакет доказательств. В галерею телефона они не дублируются.'],
    ['Поможет ли это в суде?',
      'Суд оценивает доказательства по своему внутреннему убеждению (статья 67 ГПК РФ). Приложение даёт датированные, подписанные и заверенные независимым временем записи — это сильнее скриншотов, но исход дела не гарантирует.']
  ];

  function showFaq() {
    const wrap = el('div');
    wrap.innerHTML = FAQ_ITEMS.map(function (qa) {
      return '<details class="card" style="margin:0 0 8px"><summary><b>' + U.esc(qa[0]) + '</b></summary>' +
        '<div class="muted small" style="margin-top:8px">' + U.esc(qa[1]) + '</div></details>';
    }).join('');
    openModal('Частые вопросы', wrap);
  }

  const TERMS_ITEMS = [
    ['Кто мы', 'Приложение «АрендаЛог» — бесплатный инструмент для фиксации состояния жилья. Оно не является юридической услугой и не заменяет юриста.'],
    ['Ваши данные', 'Все записи, фото и документы хранятся на вашем устройстве. Разработчик не имеет к ним доступа и не собирает персональные данные. Передача происходит только по вашему действию: при экспорте файла или подключении собственного сервера.'],
    ['Ответственность за сохранность', 'Вы сами отвечаете за сохранность данных. Резервные копии не создаются автоматически. Потеря или поломка устройства означает потерю записей, если копия не была сохранена заранее.'],
    ['Содержание записей', 'Вы отвечаете за достоверность вносимых сведений. Запрещено использовать приложение для фальсификации доказательств и незаконного наблюдения за людьми.'],
    ['Никаких гарантий', 'Приложение предоставляется «как есть», без гарантий пригодности для конкретной цели. Мы не гарантируем, что суд или иной орган примет записи в качестве доказательства.'],
    ['Пределы ответственности', 'Разработчик не возмещает убытки, возникшие из-за использования или невозможности использования приложения, в пределах, допускаемых законом.'],
    ['Изменения', 'Условия могут меняться вместе с версиями приложения. Актуальная редакция всегда доступна в этом разделе.']
  ];

  function termsHtml() {
    return TERMS_ITEMS.map(function (t) {
      return '<div class="card" style="margin:0 0 8px"><b>' + U.esc(t[0]) + '</b>' +
        '<div class="muted small" style="margin-top:6px">' + U.esc(t[1]) + '</div></div>';
    }).join('') +
      '<p class="muted small">Редакция от 29 октября 2026 года. Исходный код открыт — его можно проверить.</p>';
  }

  function showTerms() {
    const wrap = el('div');
    wrap.innerHTML = termsHtml();
    openModal('Условия использования', wrap);
  }

  async function ensureTerms() {
    const accepted = await DB.getSet('termsAccepted', 0);
    if (accepted) return;
    const wrap = el('div');
    wrap.innerHTML = '<div class="card"><b>Перед началом работы</b>' +
      '<div class="muted small" style="margin-top:6px">Ознакомьтесь с условиями использования — это коротко.</div></div>' +
      termsHtml() +
      '<button class="btn primary" id="tAccept">Принимаю</button>';
    wrap.querySelector('#tAccept').addEventListener('click', async () => {
      await DB.set('termsAccepted', Date.now());
      closeModal();
      toast('Условия приняты');
    });
    openModal('Условия использования', wrap);
  }

  /* ─────────────── Состояние подтверждения времени и напоминание о копии ─────────────── */
  async function refreshTsaInfo() {
    const node = $('#tsaInfo');
    if (!node) return;
    const total = state.events.length;
    const done = state.events.filter(e => e.tsa).length;
    node.textContent = total === 0
      ? 'записей пока нет'
      : (done === total ? `все ${total} записей подтверждены` : `${done} из ${total} подтверждено · ${total - done} ждут`);
  }

  async function refreshBackupBanner() {
    const box = $('#backupBox');
    if (!box) return;
    const last = await DB.getSet('lastBackupAt', 0);
    const days = last ? (Date.now() - last) / 86400000 : Infinity;
    if (state.events.length < 3 || days < 14) { box.className = 'integrity hide'; box.innerHTML = ''; return; }
    box.className = 'integrity';
    box.style.background = 'rgba(255,159,67,.12)';
    box.style.borderColor = 'rgba(255,159,67,.45)';
    box.style.color = '#ffd9a8';
    box.innerHTML = last
      ? `Копия не сохранялась ${Math.floor(days)} дн. · <a href="#" id="bkGo" style="color:#fff;font-weight:700">сохранить</a>`
      : 'Записи только на этом телефоне · <a href="#" id="bkGo" style="color:#fff;font-weight:700">сохранить копию</a>';
    box.style.display = 'flex';
    const go = box.querySelector('#bkGo');
    if (go) go.addEventListener('click', async e => {
      e.preventDefault();
      await exportBackup(false);
    });
  }

  /* ─────────────── Договор аренды ─────────────── */
  function contractIds() { return state.journal.contract || []; }

  function renderContract() {
    const box = $('#contractList');
    if (!box) return;
    const ids = contractIds();
    box.innerHTML = '';
    if (!ids.length) {
      box.appendChild(el('div', { class: 'muted small' },
        'Договор пока не добавлен. Сфотографируйте страницы — они будут всегда под рукой, даже без интернета.'));
      return;
    }
    const grid = el('div', { class: 'photo-grid' });
    ids.forEach(pid => {
      const p = state.photos[pid];
      if (!p) return;
      const isDoc = p.kind === 'doc';
      const cell = el('div', { class: 'photo-cell', style: 'position:relative' });
      cell.innerHTML = isDoc
        ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:11px;text-align:center;padding:6px;background:#12161c">📎<br>' +
          U.esc((p.name || 'файл').slice(0, 18)) + '</div><button class="del">✕</button>'
        : '<img src="' + (state.photoUrl[pid] || '') + '" alt=""><button class="del">✕</button>';
      cell.addEventListener('click', () => openDoc(pid));
      const del = cell.querySelector('.del');
      del.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Убрать страницу договора?')) return;
        state.journal.contract = contractIds().filter(x => x !== pid);
        await saveJournal();
        try { await DB.del('photos', pid); } catch (e2) { }
        await loadAll();
        toast('Убрано');
      });
      grid.appendChild(cell);
    });
    box.appendChild(grid);
  }

  async function addContractDocs(useCamera) {
    const input = el('input', {
      type: 'file',
      accept: useCamera ? 'image/*' : 'image/*,application/pdf',
      multiple: 'multiple'
    });
    if (useCamera) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      let added = 0;
      for (const file of Array.from(input.files || [])) {
        try {
          let blob = file, w = 0, h = 0, kind = 'doc';
          let mime = file.type || 'application/octet-stream';
          if (/^image\//.test(file.type)) {
            const r = await global.AL.compressImage(file, 1800);
            blob = r.blob; w = r.w; h = r.h; mime = 'image/jpeg'; kind = 'photo';
          }
          const pid = U.uid();
          const sha = await U.sha256Hex(await blob.arrayBuffer());
          await DB.put('photos', {
            id: pid, journalId: state.journal.id, eventId: null,
            blob: blob, mime: mime, w: w, h: h, sha256: sha,
            ts: U.nowISO(), kind: kind, name: file.name || null
          });
          state.journal.contract = contractIds().concat([pid]);
          added++;
        } catch (e) { toast('Не удалось добавить файл'); }
      }
      input.remove();
      if (added) {
        await saveJournal();
        await loadAll();
        toast('Добавлено страниц: ' + added);
      }
    });
    input.click();
  }

  async function openDoc(pid) {
    const p = state.photos[pid];
    if (!p) return;
    const isDoc = p.kind === 'doc';
    const wrap = el('div');
    wrap.innerHTML = isDoc
      ? '<div class="card"><b>' + U.esc(p.name || 'документ') + '</b>' +
        '<div class="muted small" style="margin-top:6px">' + Math.round(p.blob.size / 1024) + ' КБ</div></div>'
      : '<div class="card"><img src="' + (state.photoUrl[pid] || '') + '" style="width:100%;border-radius:10px" alt=""></div>';
    const save = el('button', { class: 'btn primary' }, 'Сохранить в телефон');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const b64 = await blobToB64(p.blob);
        const ext = (isDoc && p.name && p.name.indexOf('.') > 0) ? p.name.split('.').pop() : 'jpg';
        const nm = 'Договор-' + U.fmtDate(U.nowISO()).replace(/\./g, '-') + '-' + pid.slice(0, 4) + '.' + ext;
        const r = await Bridge.saveFile(nm, b64, p.mime || 'image/jpeg');
        toast(r.ok ? 'Сохранено: ' + (r.path || 'в загрузки') : 'Ошибка: ' + r.error);
      } catch (e) { toast('Не удалось сохранить'); }
      save.disabled = false;
    });
    wrap.appendChild(save);
    wrap.appendChild(el('p', { class: 'muted small' },
      'Файл попадёт в «Загрузки» — оттуда его можно отправить кому угодно: почтой, в мессенджере или через облако.'));
    openModal(isDoc ? 'Документ' : 'Страница договора', wrap);
  }

  function renderObject() {
    const j = state.journal;
    $('#fTitle').value = j.title || '';
    $('#fAddress').value = j.address || '';
    $('#fTenant').value = j.tenant || '';
    $('#fLandlord').value = j.landlord || '';
    $('#fLandlordPhone').value = j.landlordPhone || '';
    $('#fDeposit').value = j.deposit || '';
    $('#fRent').value = j.rent || '';
    $('#fStart').value = j.start || '';
    $('#fEnd').value = j.end || '';
    renderZones();
    renderPeople();
    renderContract();
  }

  function renderDeadlines() {
    const box = $('#deadlines');
    const j = state.journal;
    const items = [];
    if (j.end) {
      const end = new Date(j.end);
      const days = Math.ceil((end - Date.now()) / 86400000);
      items.push([`Окончание договора: ${U.fmtDate(j.end)}`,
        days > 0 ? `через ${days} дн.` : (days === 0 ? 'сегодня' : `${-days} дн. назад`)]);
    }
    if (j.deposit) items.push(['Залог к возврату', U.money(j.deposit)]);
    items.push(['Событий в журнале', String(state.events.length)]);
    if (state.events.length) {
      const first = state.events.slice().sort((a, b) => (a.tsDevice > b.tsDevice ? 1 : -1))[0];
      items.push(['Записи ведутся с', U.fmtDate(first.tsDevice)]);
    }
    items.push(['Приёмок и сдач', String(state.handovers.length)]);
    box.innerHTML = items.map(([k, v]) => `<div class="kv"><span>${U.esc(k)}</span><b>${U.esc(v)}</b></div>`).join('');
  }

  /* ─────────────── PIN ─────────────── */
  async function setPin() {
    const input = $('#fPin');
    const pin = (input.value || '').trim();
    if (!pin) {
      await DB.put('settings', { k: 'pin', v: null });
      toast('PIN снят');
      return;
    }
    if (!/^\d{4,8}$/.test(pin)) { toast('Нужно 4–8 цифр'); return; }
    const salt = U.uid();
    await DB.put('settings', { k: 'pin', v: { salt, hash: await U.sha256Hex(salt + pin) } });
    input.value = '';
    toast('PIN установлен — он спросится при следующем запуске');
  }

  async function requirePin() {
    const rec = await DB.getSet('pin', null);
    if (!rec) return true;
    $('#modal').dataset.locked = '1';
    $('#modalClose').style.display = 'none';
    const wrap = el('div');
    wrap.innerHTML = `
      <label>PIN-код
        <input id="pinInput" type="password" inputmode="numeric" autofocus>
      </label>
      <button class="btn primary" id="pinOk">Войти</button>
    `;
    openModal('Вход', wrap);
    return new Promise(resolve => {
      const submit = async () => {
        const val = wrap.querySelector('#pinInput').value;
        const h = await U.sha256Hex(rec.salt + val);
        if (h === rec.hash) {
          $('#modal').dataset.locked = '';
          $('#modalClose').style.display = '';
          closeModal();
          resolve(true);
        } else { toast('Неверный PIN'); }
      };
      wrap.querySelector('#pinOk').addEventListener('click', submit);
      wrap.querySelector('#pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    });
  }

  /* ─────────────── Экспорт интерфейса ─────────────── */
  const UI = {
    TYPES, ROOM_PRESET, state,
    init() {
      $('#modalClose').addEventListener('click', closeModal);
      $('#modal').addEventListener('click', e => {
        if ($('#modal').dataset.locked === '1') return;
        if (e.target.id === 'modal') closeModal();
      });
      $$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
      $('#fabAdd').addEventListener('click', () => addEventForm('defect'));

      $('#filterChips').addEventListener('click', e => {
        const b = e.target.closest('.chip');
        if (!b) return;
        state.filter = b.dataset.filter;
        $$('#filterChips .chip').forEach(c => c.classList.toggle('active', c === b));
        renderTimeline();
      });

      document.addEventListener('click', e => {
        const bb = e.target.closest('[data-go]');
        if (!bb) return;
        const v = bb.dataset.go;
        if (v === 'handover-accept') { showTab('handover'); startHandover('accept'); }
        if (v === 'handover-return') { showTab('handover'); startHandover('return'); }
        if (v === 'add-defect') addEventForm('defect');
        if (v === 'add-improvement') addEventForm('improvement');
      });

      $('#handoverIntro').addEventListener('click', e => {
        const b = e.target.closest('[data-hv]');
        if (b) startHandover(b.dataset.hv);
      });

      $('#btnContractPhoto').addEventListener('click', () => addContractDocs(true));
      $('#btnContractFile').addEventListener('click', () => addContractDocs(false));
      $('#btnAddZone').addEventListener('click', () => editZone(null));
      $('#btnZoneTpl').addEventListener('click', zoneTemplates);
      $('#btnAddPerson').addEventListener('click', () => editPerson(null));
      $('#objForm').addEventListener('submit', async e => {
        e.preventDefault();
        Object.assign(state.journal, {
          title: $('#fTitle').value.trim() || 'АрендаЛог',
          address: $('#fAddress').value.trim(),
          tenant: $('#fTenant').value.trim(),
          landlord: $('#fLandlord').value.trim(),
          landlordPhone: $('#fLandlordPhone').value.trim(),
          deposit: $('#fDeposit').value,
          rent: $('#fRent').value,
          start: $('#fStart').value,
          end: $('#fEnd').value
        });
        await saveJournal();
        renderHeader(); renderDeadlines();
        const st = state.journal.start;
        const startedLongAgo = st && (Date.now() - new Date(st).getTime()) > 3 * 86400000;
        toast(startedLongAgo && !state.events.length
          ? 'Сохранено. Журнал начат с середины срока — записи пойдут с сегодняшнего дня, в отчёте это будет указано.'
          : 'Сохранено');
      });

      $('#btnReport').addEventListener('click', () => showReport(false));
      $('#btnPrint').addEventListener('click', () => showReport(true));
      $('#btnPrintAll').addEventListener('click', printWithContract);
      $('#btnZip').addEventListener('click', exportZip);
      $('#btnVerify').addEventListener('click', openVerifier);
      $('#btnBackup').addEventListener('click', () => exportBackup(false));
      $('#btnImport').addEventListener('click', importBackup);
      $('#btnInvite').addEventListener('click', () => exportBackup(true));
      $('#btnFaq').addEventListener('click', showFaq);
      $('#btnTerms').addEventListener('click', showTerms);
      $('#btnPin').addEventListener('click', setPin);
      if (global.Update) {
        $('#btnCheckUpdate').addEventListener('click', () => global.Update.manual());
        $('#btnDiag').addEventListener('click', () => global.Update.diagnose());
        refreshVersionCard();
      }

      $('#btnWipe').addEventListener('click', async () => {
        if (!confirm('Удалить все данные без возможности восстановления?')) return;
        await DB.clearAll();
        state.photoUrl = {};
        await loadAll();
        showTab('home');
        toast('Данные удалены');
      });
      $('#btnTsaTest').addEventListener('click', async () => {
        const url = $('#fTsa').value.trim() || state.tsaUrl;
        state.tsaUrl = url;
        await DB.set('tsaUrl', url);
        toast('Проверяю…');
        try {
          const testHash = await U.sha256Hex('arendalog-test-' + Date.now());
          const res = await TSA.stamp(testHash, url);
          toast('TSA отвечает: ' + U.fmtDateTime(res.time));
        } catch (e) { toast('TSA недоступен: ' + e.message); }
      });
      $('#btnTsaQueue').addEventListener('click', async () => {
        toast('Отправляю очередь…');
        const r = await flushQueue();
        await loadAll();
        toast(`Отправлено: ${r.sent}, осталось: ${r.left || 0}`);
      });

      renderHandovers();
    },
    loadAll, renderStats, renderTimeline, renderHandovers, renderObject, renderDeadlines,
    requirePin, showTab, toast, verifyChain, buildEvidencePackage, refreshVersionCard,
    openModal, closeModal, ensureTerms, refreshTsaInfo, refreshBackupBanner, buildReportWithContract, printWithContract
  };
  global.UI = UI;
})(window);
