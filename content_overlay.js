/**
 * content_overlay.js — Timery v3.1.0
 * ------------------------------------------------------------------
 * نمایش تایمرهای فعال روی صفحهٔ وب.
 *  • گارد تزریق (هر صفحه فقط یک‌بار اجرا می‌شود)
 *  • پشتیبانی از چند تایمر همزمان
 *  • قابلیت جابه‌جایی، کوچک‌سازی و پنهان‌سازی
 *  • شمارش معکوس در عنوان تب (اختیاری)
 */
(function () {
  'use strict';

  // ---------- گارد: از اجرای دوباره جلوگیری می‌کند ----------
  if (window.__timeryOverlayLoaded) {
    console.log('⏭ content_overlay.js از قبل بارگذاری شده بود');
    return;
  }
  window.__timeryOverlayLoaded = true;

  const CONTAINER_ID = 'timery-overlay';
  const MINI_ID = 'timery-mini';
  const STYLE_ID = 'timery-style';

  let container = null;
  let miniIcon = null;
  let originalTitle = document.title;
  let minimized = false;
  let hidden = false;
  let tickHandle = null;
  let timers = [];
  let settings = { titleCountdown: true, soundEnabled: true };

  // ==================== استایل ====================
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CONTAINER_ID} {
        position: fixed; top: 16px; right: 16px; z-index: 2147483647;
        width: 264px; max-height: 70vh; overflow: hidden auto;
        background: linear-gradient(160deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%);
        color: #fff; font-family: Vazirmatn, "Segoe UI", Tahoma, sans-serif;
        border-radius: 16px; padding: 12px; direction: rtl; text-align: right;
        box-shadow: 0 18px 45px rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.16);
        backdrop-filter: blur(14px); user-select: none; transition: opacity .2s ease, transform .2s ease;
      }
      #${CONTAINER_ID}.tm-mini { width: auto; padding: 8px 12px; }
      #${CONTAINER_ID} .tm-head {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        font-size: 12px; opacity: .85; margin-bottom: 8px; cursor: move;
      }
      #${CONTAINER_ID} .tm-head b { font-size: 13px; opacity: 1; }
      #${CONTAINER_ID} .tm-btns { display: flex; gap: 4px; }
      #${CONTAINER_ID} .tm-btns button {
        background: rgba(255,255,255,.14); border: none; color: #fff; width: 22px; height: 22px;
        border-radius: 6px; cursor: pointer; font-size: 12px; line-height: 1;
        display: flex; align-items: center; justify-content: center; padding: 0;
      }
      #${CONTAINER_ID} .tm-btns button:hover { background: rgba(255,255,255,.28); }
      #${CONTAINER_ID} .tm-btns button.tm-danger:hover { background: #ef4444; }
      #${CONTAINER_ID} .tm-card {
        background: rgba(255,255,255,.1); border-radius: 12px; padding: 10px 12px; margin-bottom: 8px;
        border-right: 3px solid #a5b4fc; backdrop-filter: blur(4px);
      }
      #${CONTAINER_ID} .tm-card:last-child { margin-bottom: 0; }
      #${CONTAINER_ID} .tm-title { font-size: 12px; opacity: .9; margin-bottom: 4px; }
      #${CONTAINER_ID} .tm-time {
        font-size: 26px; font-weight: 800; font-family: "Courier New", monospace;
        direction: ltr; text-align: right; letter-spacing: 1px;
      }
      #${CONTAINER_ID} .tm-time.warn { color: #fbbf24; }
      #${CONTAINER_ID} .tm-time.danger { color: #fca5a5; }
      #${CONTAINER_ID} .tm-bar { height: 4px; background: rgba(255,255,255,.18); border-radius: 4px; margin: 8px 0 6px; overflow: hidden; }
      #${CONTAINER_ID} .tm-bar > i { display: block; height: 100%; background: #a5b4fc; border-radius: 4px; transition: width .3s linear; }
      #${CONTAINER_ID} .tm-row { display: flex; align-items: center; justify-content: space-between; font-size: 11px; opacity: .75; }
      #${CONTAINER_ID} .tm-actions { display: flex; gap: 6px; margin-top: 8px; }
      #${CONTAINER_ID} .tm-actions button {
        flex: 1; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.18);
        color: #fff; border-radius: 8px; padding: 5px 6px; font-size: 11px; cursor: pointer;
        font-family: inherit;
      }
      #${CONTAINER_ID} .tm-actions button:hover { background: rgba(255,255,255,.3); }
      #${CONTAINER_ID} .tm-actions button.tm-danger:hover { background: #ef4444; border-color: #ef4444; }
      #${CONTAINER_ID} .tm-empty { font-size: 12px; opacity: .8; text-align: center; padding: 10px 0; }
      #${MINI_ID} {
        position: fixed; top: 16px; right: 16px; z-index: 2147483646; width: 44px; height: 44px;
        background: linear-gradient(160deg, #4338ca, #6366f1); color: #fff; border-radius: 50%;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        cursor: pointer; box-shadow: 0 8px 22px rgba(0,0,0,.35); font-size: 16px;
        border: 2px solid rgba(255,255,255,.25);
      }
      #${MINI_ID} small { font-size: 9px; font-family: "Courier New", monospace; direction: ltr; }
    `;
    document.documentElement.appendChild(style);
  }

  // ==================== ساخت کانتینر ====================
  function createContainer() {
    if (container) {
      container.style.display = 'block';
      return container;
    }
    injectStyle();

    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.innerHTML = `
      <div class="tm-head" id="tm-drag">
        <b>⏰ تایمرهای فعال</b>
        <div class="tm-btns">
          <span id="tm-focus-badge" title="حالت تمرکز فعال" style="display:none;font-size:13px;">🛡</span>
          <button id="tm-minimize" title="کوچک کردن">−</button>
          <button id="tm-hide" title="پنهان کردن">▫</button>
          <button id="tm-close-all" class="tm-danger" title="بستن همه">×</button>
        </div>
      </div>
      <div id="tm-list"></div>
    `;
    document.body.appendChild(container);

    container.querySelector('#tm-minimize').addEventListener('click', (e) => { e.stopPropagation(); toggleMinimize(); });
    container.querySelector('#tm-hide').addEventListener('click', (e) => { e.stopPropagation(); toggleHide(); });
    container.querySelector('#tm-close-all').addEventListener('click', (e) => { e.stopPropagation(); closeAll(); });
    makeDraggable(container.querySelector('#tm-drag'), container);

    return container;
  }

  function makeDraggable(handle, element) {
    let dragging = false, startX = 0, startY = 0, initialX = 0, initialY = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = element.getBoundingClientRect();
      initialX = rect.left; initialY = rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    function onMove(e) {
      if (!dragging) return;
      element.style.left = (initialX + e.clientX - startX) + 'px';
      element.style.top = (initialY + e.clientY - startY) + 'px';
      element.style.right = 'auto';
    }
    function onUp() {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  }

  // ==================== آیکون کوچک ====================
  function createMiniIcon() {
    if (miniIcon) return;
    miniIcon = document.createElement('div');
    miniIcon.id = MINI_ID;
    miniIcon.title = 'Timery — تایمر فعال (کلیک کنید)';
    miniIcon.innerHTML = '<span>⏰</span><small>00:00</small>';
    miniIcon.addEventListener('click', toggleHide);
    document.body.appendChild(miniIcon);
  }

  function removeMiniIcon() {
    if (miniIcon) { miniIcon.remove(); miniIcon = null; }
  }

  // ==================== رندر ====================
  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  }

  function render() {
    if (!timers.length) {
      removeContainer();
      restoreTitle();
      return;
    }
    if (hidden) return;

    const box = createContainer();
    const list = box.querySelector('#tm-list');
    list.textContent = '';

    for (const timer of timers) {
      const remaining = timer.remaining;
      const progress = timer.totalSeconds > 0
        ? Math.max(0, Math.min(100, ((timer.totalSeconds - remaining) / timer.totalSeconds) * 100))
        : 0;

      const card = document.createElement('div');
      card.className = 'tm-card';
      if (timer.color) card.style.borderRightColor = timer.color;

      const title = document.createElement('div');
      title.className = 'tm-title';
      title.textContent = timer.title;

      const time = document.createElement('div');
      time.className = 'tm-time';
      time.textContent = formatClock(remaining);
      if (remaining <= 10) time.classList.add('danger');
      else if (remaining <= 30) time.classList.add('warn');

      const bar = document.createElement('div');
      bar.className = 'tm-bar';
      const fill = document.createElement('i');
      fill.style.width = progress + '%';
      if (timer.color) fill.style.background = timer.color;
      bar.appendChild(fill);

      const row = document.createElement('div');
      row.className = 'tm-row';
      const status = document.createElement('span');
      status.textContent = timer.paused ? '⏸ متوقف' : `${Math.round(progress)}٪ گذشته`;
      const total = document.createElement('span');
      total.textContent = 'کل: ' + formatClock(timer.totalSeconds);
      row.appendChild(status);
      row.appendChild(total);

      const actions = document.createElement('div');
      actions.className = 'tm-actions';

      const pauseBtn = document.createElement('button');
      pauseBtn.textContent = timer.paused ? '▶ ادامه' : '⏸ توقف';
      pauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'toggle_timer', timerId: timer.id }).catch(() => { });
      });

      const stopBtn = document.createElement('button');
      stopBtn.className = 'tm-danger';
      stopBtn.textContent = '✕ حذف';
      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'stop_timer', timerId: timer.id }).catch(() => { });
      });

      actions.appendChild(pauseBtn);
      actions.appendChild(stopBtn);

      card.appendChild(title);
      card.appendChild(time);
      card.appendChild(bar);
      card.appendChild(row);
      card.appendChild(actions);
      list.appendChild(card);
    }

    updateMiniIcon();
    updateTitle();
  }

  function updateMiniIcon() {
    if (!miniIcon) return;
    const nearest = nearestTimer();
    const small = miniIcon.querySelector('small');
    if (small && nearest) small.textContent = formatClock(nearest.remaining);
  }

  function nearestTimer() {
    const active = timers.filter((t) => !t.paused);
    if (!active.length) return timers[0] || null;
    return active.sort((a, b) => a.endTime - b.endTime)[0];
  }

  // ==================== عنوان تب ====================
  function updateTitle() {
    if (!settings.titleCountdown) { restoreTitle(); return; }
    const nearest = nearestTimer();
    if (!nearest) { restoreTitle(); return; }
    document.title = `(${formatClock(nearest.remaining)}) ${originalTitle}`;
  }

  function restoreTitle() {
    if (document.title !== originalTitle) document.title = originalTitle;
  }

  // ==================== کنترل‌ها ====================
  function toggleMinimize() {
    if (!container) return;
    minimized = !minimized;
    const list = container.querySelector('#tm-list');
    const btn = container.querySelector('#tm-minimize');
    if (minimized) {
      list.style.display = 'none';
      btn.textContent = '+';
      btn.title = 'باز کردن';
      const nearest = nearestTimer();
      container.querySelector('.tm-head b').textContent = nearest ? '⏱ ' + formatClock(nearest.remaining) : '⏰ Timery';
    } else {
      list.style.display = 'block';
      btn.textContent = '−';
      btn.title = 'کوچک کردن';
      container.querySelector('.tm-head b').textContent = '⏰ تایمرهای فعال';
    }
    updateMiniIcon();
  }

  function toggleHide() {
    hidden = !hidden;
    if (hidden) {
      createMiniIcon();
      if (container) container.style.display = 'none';
    } else {
      removeMiniIcon();
      if (container) container.style.display = 'block';
    }
  }

  function closeAll() {
    chrome.runtime.sendMessage({ action: 'stop_timer', timerId: null }).catch(() => { });
  }

  function removeContainer() {
    stopTicking();
    if (container) { container.remove(); container = null; }
    minimized = false;
    hidden = false;
    removeMiniIcon();
  }

  // ==================== تیک ====================
  function stopTicking() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }

  function startTicking() {
    stopTicking();
    tickHandle = setInterval(() => {
      if (!timers.length) return;
      const now = Date.now();
      let changed = false;
      for (const timer of timers) {
        if (!timer.paused && timer.endTime > now) {
          timer.remaining = Math.max(0, Math.floor((timer.endTime - now) / 1000));
          changed = true;
        }
      }
      if (changed) {
        render();
      }
    }, 500);
  }

  // ==================== صدا ====================
  function playSound(src) {
    try {
      const audio = new Audio(src);
      audio.volume = 1;
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { });
    } catch (e) { /* بی‌خیال */ }
  }

  // ==================== پیام‌ها ====================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'ping':
        sendResponse({ ok: true });
        break;

      case 'sync_state': {
        timers = Array.isArray(message.timers) ? message.timers : [];
        settings = { ...settings, ...(message.settings || {}) };
        const badge = document.getElementById('tm-focus-badge');
        if (badge) badge.style.display = settings.focusEnabled ? 'inline-block' : 'none';
        render();
        startTicking();
        sendResponse({ ok: true });
        break;
      }

      case 'timer_ended': {
        flashOverlay(message.timerId);
        sendResponse({ ok: true });
        break;
      }

      case 'play_sound': {
        playSound(message.src);
        sendResponse({ ok: true });
        break;
      }

      case 'cleanup': {
        removeContainer();
        restoreTitle();
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false });
    }
    return true;
  });

  function flashOverlay() {
    if (!container || hidden) return;
    container.style.transform = 'scale(1.03)';
    setTimeout(() => { if (container) container.style.transform = 'scale(1)'; }, 220);
  }

  console.log('✅ Timery overlay آماده است');
})();
