/* АрендаЛог — запуск */
(function (global) {
  'use strict';

  async function boot() {
    const { UI, AL } = global;

    // защита от двойного запуска
    if (global.__arendalogBooted) return;
    global.__arendalogBooted = true;

    try {
      // проверяем поддержку нужных API
      if (!global.crypto || !global.crypto.subtle) {
        document.body.innerHTML =
          '<div style="padding:24px;font:15px sans-serif;color:#fff;background:#0e1116;min-height:100vh">' +
          '<h2>Нужен современный WebView</h2><p>Приложение использует криптографию устройства. ' +
          'Обновите системный компонент «Android System WebView» в Play Маркете.</p></div>';
        return;
      }
      if (!global.indexedDB) {
        document.body.innerHTML =
          '<div style="padding:24px;font:15px sans-serif;color:#fff;background:#0e1116;min-height:100vh">' +
          '<h2>Нет доступа к хранилищу</h2><p>Приложению нужно локальное хранилище браузера.</p></div>';
        return;
      }

      UI.init();
      await UI.requirePin();
      if (global.Sync) { try { await global.Sync.load(); } catch (e) { } }
      await UI.loadAll();
      UI.renderHandovers();
      UI.showTab('home');
      await UI.ensureTerms();
      // проверка обновлений — в фоне, не блокирует старт
      if (global.Update) setTimeout(() => global.Update.check(true).catch(() => {}), 1500);

      // просим браузер не вытеснять данные
      if (navigator.storage && navigator.storage.persist) {
        try { await navigator.storage.persist(); } catch (e) { /* не критично */ }
      }

      // первый запуск: подсказка
      const seen = await AL.DB.getSet('onboarded', false);
      if (!seen) {
        await AL.DB.set('onboarded', true);
        UI.toast('Заполните «Объект», затем фиксируйте факты кнопкой +', 4200);
      }
    } catch (e) {
      console.error(e);
      document.body.innerHTML =
        '<div style="padding:24px;font:15px sans-serif;color:#ffb3b3;background:#0e1116;min-height:100vh">' +
        '<h2>Ошибка запуска</h2><pre style="white-space:pre-wrap">' +
        (e && e.message ? e.message : String(e)) + '</pre></div>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
