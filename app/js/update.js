/* АрендаЛог — проверка обновлений через GitHub Releases */
(function (global) {
  'use strict';
  const { U, DB } = global.AL;

  const REPO = 'luckyvoron-tech/arendalog';
  const CURRENT = '1.0.0';
  const CHECK_INTERVAL = 6 * 3600 * 1000; // не чаще раза в 6 часов

  const UPD = {
    current: CURRENT,
    latest: null,

    parse(v) {
      return String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    },
    isNewer(remote, local) {
      const a = UPD.parse(remote), b = UPD.parse(local);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0, y = b[i] || 0;
        if (x > y) return true;
        if (x < y) return false;
      }
      return false;
    },

    async check(silent) {
      if (!navigator.onLine) return null;
      if (silent) {
        const last = await DB.getSet('lastUpdateCheck', 0);
        if (last && Date.now() - last < CHECK_INTERVAL) {
          const cached = await DB.getSet('updateCache', null);
          if (cached && cached.version) UPD.render(cached);
          return cached;
        }
      }
      await DB.set('lastUpdateCheck', Date.now());
      try {
        const r = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
          headers: { 'Accept': 'application/vnd.github+json' }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const rel = await r.json();
        const version = String(rel.tag_name || '').replace(/^v/i, '');
        const assets = rel.assets || [];
        const apk = assets.find(a => /\.apk$/i.test(a.name)) || assets[0];
        const url = apk ? apk.browser_download_url : rel.html_url;
        UPD.latest = { version, url, notes: rel.body || '', published: rel.published_at };
        await DB.set('updateCache', UPD.latest);
        if (UPD.isNewer(version, CURRENT)) {
          UPD.render(UPD.latest);
          return UPD.latest;
        }
        UPD.hide();
        if (!silent) global.UI.toast('Установлена последняя версия ' + CURRENT);
        return null;
      } catch (e) {
        if (!silent) global.UI.toast('Не удалось проверить: ' + e.message);
        return null;
      }
    },

    render(info) {
      const box = document.getElementById('updateBox');
      if (!box || !info) return;
      box.className = 'integrity';
      box.style.background = 'rgba(76,141,255,.12)';
      box.style.borderColor = 'rgba(76,141,255,.45)';
      box.style.color = '#cfe0ff';
      box.innerHTML = `⬆️ Доступна версия ${U.esc(info.version)} · ` +
        `<a href="${U.esc(info.url)}" style="color:#fff;font-weight:700;text-decoration:underline">скачать</a>` +
        ` <span class="muted small">(откроется браузер)</span>`;
      box.style.display = 'flex';
    },

    hide() {
      const box = document.getElementById('updateBox');
      if (box) { box.className = 'integrity hide'; box.innerHTML = ''; }
    },

    async manual() {
      global.UI.toast('Проверяю обновления…');
      await UPD.check(false);
    }
  };

  global.Update = UPD;
})(window);
