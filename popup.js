/**
 * popup.js — Timery v3.2.0
 * ------------------------------------------------------------------
 * رابط کاربری: تایمر (با حلقهٔ پیشرفت)، پومودورو و حالت تمرکز،
 * کرنومتر، یادآورها، ابزارهای تاریخ و تنظیمات.
 */
(function () {
  'use strict';

  /* ==================== وضعیت ==================== */
  const state = {
    timers: [],
    reminders: [],
    settings: {},
    stats: {},
    laps: [],
    lastTab: 'timer'
  };

  let tickHandle = null;
  let swHandle = null;
  let swBase = 0;
  let swStart = 0;
  let swRunning = false;

  const WEEKDAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  const REPEAT_LABELS = {
    once: 'یک‌بار', daily: 'روزانه', weekly: 'هفتگی', monthly: 'ماهانه', yearly: 'سالانه'
  };
  const CONFIG = (typeof TIMERY_CONFIG !== 'undefined' && TIMERY_CONFIG) || {};

  /** کلید ساختگی (handle) که در js/config.js تنظیم شده — نه توکن واقعی */
  function baleKey() {
    return String(CONFIG.baleKey || '').trim();
  }

  /** روش مستقیم: توکن بات داخل config.js است (بدون نیاز به سرور)
   *  🔒 فقط اگر توسعه‌دهنده صریحاً `allowDirectToken: true` گذاشته باشد */
  function isDirectMode() {
    if (CONFIG.allowDirectToken !== true) return false;
    const token = String(CONFIG.baleToken || '').trim();
    return token.length > 10 && !/TOKEN_HERE|CHANGE|YOUR/i.test(token);
  }

  /** حالت ارتباط بله: direct | proxy | none */
  function baleMode() {
    if (baleKey() && String(CONFIG.proxyUrl || '').trim()) return 'proxy';
    if (isDirectMode()) return 'direct';
    return 'none';
  }

  /** نمایش وضعیت روش ارتباط */
  function renderBaleMode() {
    const note = $('bale-mode-note');
    if (!note) return;
    const mode = baleMode();

    if (mode === 'proxy') {
      note.hidden = false;
      note.className = 'mode-note';
      note.textContent = '✅ حالت واسط: افزونه با یک «کلید ساختگی» به سرور وصل می‌شود و پیام‌ها از آنجا ارسال می‌شود (توکن واقعی روی سرور می‌ماند).';
    } else if (mode === 'direct') {
      note.hidden = false;
      note.className = 'mode-note warn';
      note.textContent = '⚠️ حالت مستقیم: توکن واقعی داخل افزونه است و قابل استخراج — برای انتشار عمومی بهتر است از حالت واسط استفاده شود.';
    } else {
      note.hidden = false;
      note.className = 'mode-note warn';
      note.textContent = '⚠️ ارتباط بله تنظیم نشده است. توسعه‌دهنده باید در js/config.js مقدار baleKey و proxyUrl را وارد کند.';
    }
  }

  /* ==================== ابزارها ==================== */
  const $ = (id) => document.getElementById(id);
  const fa = (v) => Utils.fa(v);
  const toLatinDigits = (str) => String(str)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatClock(totalSeconds) {
    const t = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  /** تبدیل متن آزاد به ثانیه: «۲۵ دقیقه»، «1:30»، «2h 15m»، «90» (دقیقه) */
  function parseDuration(raw) {
    if (!raw) return null;
    let text = toLatinDigits(String(raw)).trim().toLowerCase();
    if (!text) return null;

    const colon = text.match(/^(\d{1,3})\s*:\s*(\d{1,2})$/);
    if (colon) {
      const m = parseInt(colon[1], 10);
      const s = parseInt(colon[2], 10);
      if (s > 59) return null;
      return m * 60 + s;
    }
    if (/^\d+(\.\d+)?$/.test(text)) return Math.round(parseFloat(text) * 60);

    let total = 0;
    let matched = false;
    const units = [
      { re: /(\d+(?:\.\d+)?)\s*(?:ساعت(?:ها|های)?|ساعت‌ها|hours?|hr|h)(?![a-z])/g, sec: 3600 },
      { re: /(\d+(?:\.\d+)?)\s*(?:دقیقه(?:ها|های)?|دقیقه‌ها|minutes?|min|m)(?![a-z])/g, sec: 60 },
      { re: /(\d+(?:\.\d+)?)\s*(?:ثانیه(?:ها|های)?|ثانیه‌ها|seconds?|sec|s)(?![a-z])/g, sec: 1 }
    ];
    units.forEach(({ re, sec }) => {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        total += parseFloat(m[1]) * sec;
        matched = true;
      }
    });
    return matched ? Math.round(total) : null;
  }

  /** تاریخ میلادی YYYY-MM-DD از تاریخ شمسی */
  function jalaliToGregorianString(jy, jm, jd) {
    const g = Jalali.toGregorian(jy, jm, jd);
    return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
  }

  function formatNextTrigger(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const j = Jalali.toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const time = `${fa(pad(d.getHours()))}:${fa(pad(d.getMinutes()))}`;
    const today = new Date();
    const tj = Jalali.toJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());
    const isToday = j.jy === tj.jy && j.jm === tj.jm && j.jd === tj.jd;
    return isToday ? 'امروز ' + time : Jalali.formatJalali(j.jy, j.jm, j.jd) + ' ' + time;
  }

  /* ==================== ارتباط با سرویس‌ورکر ==================== */
  async function send(action, payload) {
    try {
      return await chrome.runtime.sendMessage({ action, ...(payload || {}) });
    } catch (error) {
      console.error('خطا در ارتباط با سرویس‌ورکر:', error);
      Utils.toast('ارتباط با سرویس‌ورکر برقرار نشد', 'error');
      return { success: false, error: String(error && error.message) };
    }
  }

  /* ==================== بارگذاری وضعیت ==================== */
  async function loadState() {
    const result = await chrome.storage.local.get(['timers', 'reminders', 'settings', 'stats']);
    state.timers = Array.isArray(result.timers) ? result.timers : [];
    state.reminders = Array.isArray(result.reminders) ? result.reminders : [];
    state.settings = result.settings || {};
    state.stats = result.stats || {};
    applyTheme();
    renderAll();
  }

  function renderAll() {
    renderTimers();
    renderPomodoro();
    renderFocus();
    renderReminders();
    renderStats();
    renderSettingsForm();
  }

  /* ==================== تب‌ها ==================== */
  function initTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.panel');

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.tab;
        buttons.forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        panels.forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
        state.lastTab = name;
        chrome.storage.local.set({ lastTab: name });
        if (name === 'stopwatch') loadStopwatch();
      });
    });
  }

  function restoreTab() {
    chrome.storage.local.get(['lastTab']).then((res) => {
      const name = res.lastTab || 'timer';
      const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
      if (btn) btn.click();
    });
  }

  /* ==================== پوسته ==================== */
  function applyTheme() {
    const theme = state.settings.theme || 'auto';
    document.documentElement.setAttribute('data-theme', theme);
    const btn = $('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '🌙' : theme === 'light' ? '☀' : '◐';
  }

  function initTheme() {
    $('theme-toggle').addEventListener('click', async () => {
      const order = ['auto', 'light', 'dark'];
      const current = state.settings.theme || 'auto';
      const next = order[(order.indexOf(current) + 1) % order.length];
      await send('save_settings', { patch: { theme: next } });
      state.settings.theme = next;
      applyTheme();
      Utils.toast('پوسته: ' + ({ auto: 'خودکار', light: 'روشن', dark: 'تاریک' })[next], 'info', 1500);
    });
  }

  /* ==================== ساعت هدر ==================== */
  function initClock() {
    function update() {
      const now = new Date();
      const j = Jalali.toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
      const el = $('brand-clock');
      if (el) {
        el.textContent = `${Jalali.formatJalali(j.jy, j.jm, j.jd)} · ${fa(pad(now.getHours()))}:${fa(pad(now.getMinutes()))}`;
      }
      const footer = $('footer-status');
      if (footer) footer.textContent = Jalali.formatJalaliLong(j.jy, j.jm, j.jd);
    }
    update();
    setInterval(update, 1000);
  }

  /* ==================== تایمرها ==================== */
  function initTimer() {
    $('start-timer').addEventListener('click', startCustomTimer);
    $('quick-timer-start').addEventListener('click', startQuickTimer);
    $('quick-timer-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startQuickTimer();
    });

    document.querySelectorAll('#timer-presets .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const seconds = parseInt(chip.dataset.seconds, 10);
        $('timer-hours').value = Math.floor(seconds / 3600);
        $('timer-minutes').value = Math.floor((seconds % 3600) / 60);
        $('timer-seconds').value = seconds % 60;
        startCustomTimer();
      });
    });

    $('active-timers').addEventListener('click', onTimerAction);

    $('stop-all-timers').addEventListener('click', async () => {
      const ok = await Utils.confirmDialog({
        title: 'پاک‌سازی تایمرها',
        message: 'همهٔ تایمرهای فعال متوقف شوند؟',
        okText: 'پاک کن'
      });
      if (ok) {
        await send('stop_timer', { timerId: null });
        Utils.toast('همهٔ تایمرها حذف شدند', 'success');
      }
    });
  }

  async function startCustomTimer() {
    const h = parseInt($('timer-hours').value, 10) || 0;
    const m = parseInt($('timer-minutes').value, 10) || 0;
    const s = parseInt($('timer-seconds').value, 10) || 0;
    const total = h * 3600 + m * 60 + s;

    if (total <= 0) {
      Utils.toast('زمان تایمر را وارد کنید', 'warning');
      return;
    }

    const title = $('timer-title').value.trim();
    const res = await send('start_timer', { timerData: { title, totalSeconds: total } });
    if (res.success) {
      $('timer-hours').value = 0;
      $('timer-minutes').value = 0;
      $('timer-seconds').value = 0;
      $('timer-title').value = '';
      Utils.toast('تایمر ' + formatClock(total) + ' شروع شد', 'success');
    }
  }

  async function startQuickTimer() {
    const input = $('quick-timer-input');
    const seconds = parseDuration(input.value);
    if (!seconds || seconds <= 0) {
      Utils.toast('قالب نامعتبر. مثال: «۲۵ دقیقه» یا «1:30»', 'warning');
      return;
    }
    const res = await send('start_timer', { timerData: { totalSeconds: seconds } });
    if (res.success) {
      input.value = '';
      Utils.toast('تایمر ' + formatClock(seconds) + ' شروع شد', 'success');
    }
  }

  async function onTimerAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.dataset.action === 'toggle') {
      await send('toggle_timer', { timerId: id });
    } else if (btn.dataset.action === 'stop') {
      const ok = await Utils.confirmDialog({
        title: 'حذف تایمر',
        message: 'این تایمر متوقف و حذف شود؟',
        okText: 'حذف'
      });
      if (ok) await send('stop_timer', { timerId: id });
    }
  }

  /** حلقهٔ پیشرفت SVG */
  function createRing(remaining, total, color) {
    const size = 62;
    const r = 26;
    const c = 2 * Math.PI * r;
    const ratio = total > 0 ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0;

    const wrap = Utils.el('div', 'ring');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);

    const bg = document.createElementNS(ns, 'circle');
    bg.setAttribute('class', 'ring-bg');
    bg.setAttribute('cx', size / 2); bg.setAttribute('cy', size / 2); bg.setAttribute('r', r);
    bg.setAttribute('stroke-width', '5');

    const fg = document.createElementNS(ns, 'circle');
    fg.setAttribute('class', 'ring-fg');
    fg.setAttribute('cx', size / 2); fg.setAttribute('cy', size / 2); fg.setAttribute('r', r);
    fg.setAttribute('stroke-width', '5');
    fg.setAttribute('stroke', color || '#4f46e5');
    fg.setAttribute('stroke-dasharray', c.toFixed(1));
    fg.setAttribute('stroke-dashoffset', (c * (1 - ratio)).toFixed(1));

    svg.appendChild(bg);
    svg.appendChild(fg);
    wrap.appendChild(svg);

    const label = Utils.el('div', 'ring-time', formatClock(remaining));
    wrap.appendChild(label);
    return wrap;
  }

  function renderTimers() {
    const host = $('active-timers');
    const count = $('active-timer-count');
    if (!host) return;

    const now = Date.now();
    const active = state.timers.filter((t) => (!t.paused ? t.endTime > now : true));
    if (count) count.textContent = fa(active.length);

    const stopAll = $('stop-all-timers');
    if (stopAll) stopAll.hidden = active.length === 0;

    host.innerHTML = '';
    if (!active.length) {
      const empty = Utils.el('div', 'empty-state');
      empty.appendChild(Utils.el('span', 'em', '⏳'));
      empty.appendChild(Utils.el('span', null, 'تایمر فعالی وجود ندارد'));
      host.appendChild(empty);
      return;
    }

    active.forEach((timer) => {
      const remaining = timer.paused
        ? Math.max(0, timer.remaining || 0)
        : Math.max(0, Math.floor((timer.endTime - now) / 1000));

      const card = Utils.el('div', 'timer-card' + (timer.paused ? ' paused' : ''));
      card.appendChild(createRing(remaining, timer.totalSeconds, timer.color));

      const info = Utils.el('div', 'timer-info');
      info.appendChild(Utils.el('div', 'timer-name', timer.title));

      const meta = Utils.el('div', 'timer-meta');
      meta.appendChild(Utils.el('span', null, timer.paused ? '⏸ متوقف' : 'در حال اجرا'));
      meta.appendChild(Utils.el('span', null, 'کل: ' + formatClock(timer.totalSeconds)));
      info.appendChild(meta);

      const actions = Utils.el('div', 'timer-actions');
      const pauseBtn = Utils.el('button', 'icon-action', timer.paused ? '▶' : '⏸');
      pauseBtn.title = timer.paused ? 'ادامه' : 'توقف';
      pauseBtn.dataset.action = 'toggle';
      pauseBtn.dataset.id = timer.id;

      const stopBtn = Utils.el('button', 'icon-action danger', '✕');
      stopBtn.title = 'حذف';
      stopBtn.dataset.action = 'stop';
      stopBtn.dataset.id = timer.id;

      actions.appendChild(pauseBtn);
      actions.appendChild(stopBtn);

      card.appendChild(info);
      card.appendChild(actions);
      host.appendChild(card);
    });
  }

  /** به‌روزرسانی سبک شمارش معکوس */
  function tickTimers() {
    const now = Date.now();
    state.timers.forEach((timer) => {
      if (timer.paused || timer.endTime <= now) return;
      const remaining = Math.max(0, Math.floor((timer.endTime - now) / 1000));
      timer.remaining = remaining;
    });
    // به‌روزرسانی سبک: فقط متن و حلقه
    document.querySelectorAll('#active-timers .timer-card').forEach((card, index) => {
      const timer = state.timers[index];
      if (!timer) return;
      const label = card.querySelector('.ring-time');
      if (label) label.textContent = formatClock(timer.remaining);
      const fg = card.querySelector('.ring-fg');
      if (fg) {
        const c = 2 * Math.PI * 26;
        const ratio = timer.totalSeconds > 0
          ? Math.max(0, Math.min(1, 1 - timer.remaining / timer.totalSeconds)) : 0;
        fg.setAttribute('stroke-dashoffset', (c * (1 - ratio)).toFixed(1));
      }
    });
  }

  /* ==================== پومودورو و تمرکز ==================== */
  function initPomodoro() {
    $('start-pomodoro').addEventListener('click', async () => {
      const res = await send('start_pomodoro');
      if (res.success) {
        Utils.toast('جلسهٔ تمرکز شروع شد 🍅', 'success');
        const focus = state.settings.focus;
        if (focus && focus.autoStart) await send('set_focus_mode', { enabled: true });
      }
    });

    const applyPomo = async () => {
      const focus = parseInt($('pomo-focus').value, 10) || 25;
      const brk = parseInt($('pomo-break').value, 10) || 5;
      const pomodoro = { ...(state.settings.pomodoro || {}), focus, break: brk };
      await send('save_settings', { patch: { pomodoro } });
      state.settings.pomodoro = pomodoro;
    };
    $('pomo-focus').addEventListener('change', applyPomo);
    $('pomo-break').addEventListener('change', applyPomo);

    $('toggle-focus').addEventListener('click', async () => {
      const enabled = !(state.settings.focus && state.settings.focus.enabled);
      await send('set_focus_mode', { enabled });
      await loadState();
      Utils.toast(enabled ? 'حالت تمرکز فعال شد 🛡' : 'حالت تمرکز خاموش شد', enabled ? 'success' : 'info');
    });

    $('focus-stop').addEventListener('click', async () => {
      await send('set_focus_mode', { enabled: false });
      await loadState();
      Utils.toast('حالت تمرکز خاموش شد', 'info');
    });
  }

  function renderPomodoro() {
    const pomo = state.settings.pomodoro || { focus: 25, break: 5, sessions: 4 };
    const sessions = state.stats.pomodoros || 0;

    const setVal = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
    setVal('pomo-focus', pomo.focus);
    setVal('pomo-break', pomo.break);
    setVal('pomo-focus-2', pomo.focus);
    setVal('pomo-break-2', pomo.break);
    setVal('pomo-sessions-2', pomo.sessions || 4);

    const label = $('pomo-sessions');
    if (label) label.textContent = fa(sessions) + ' جلسه امروز';

    const dots = $('pomo-dots');
    if (dots) {
      dots.innerHTML = '';
      const total = pomo.sessions || 4;
      for (let i = 0; i < total; i++) {
        const dot = Utils.el('div', 'dot-item' + (i < sessions ? ' on' : ''));
        dots.appendChild(dot);
      }
    }
  }

  function renderFocus() {
    const focus = state.settings.focus || { enabled: false, sites: [] };
    const banner = $('focus-banner');
    const pill = $('focus-pill');
    const status = $('focus-status');
    const modeState = $('focus-mode-state');
    const toggleBtn = $('toggle-focus');
    const row = toggleBtn ? toggleBtn.closest('.focus-row') : null;

    if (banner) banner.hidden = !focus.enabled;
    if (pill) pill.hidden = !focus.enabled;
    if (status) status.textContent = fa((focus.sites || []).length) + ' سایت مسدود می‌شود';
    if (modeState) {
      modeState.textContent = focus.enabled ? 'فعال' : 'خاموش';
      modeState.className = 'status-pill ' + (focus.enabled ? 'ok' : '');
    }
    if (toggleBtn) toggleBtn.textContent = focus.enabled ? '🛡 غیرفعال‌کردن حالت تمرکز' : '🛡 فعال‌سازی حالت تمرکز';
    if (row) row.classList.toggle('on', !!focus.enabled);
  }

  /* ==================== کرنومتر ==================== */
  async function loadStopwatch() {
    const result = await chrome.storage.local.get(['stopwatch']);
    const sw = result.stopwatch || { running: false, elapsed: 0, startTime: 0 };

    if (sw.running) {
      swRunning = true;
      swBase = sw.elapsed || 0;
      swStart = sw.startTime || Date.now();
      $('start-stopwatch').disabled = true;
      $('pause-stopwatch').disabled = false;
      $('lap-stopwatch').disabled = false;
      startStopwatchLoop();
    } else {
      swRunning = false;
      $('start-stopwatch').disabled = false;
      $('pause-stopwatch').disabled = true;
      $('lap-stopwatch').disabled = true;
      swBase = sw.elapsed || 0;
      updateStopwatchDisplay(swBase);
    }
  }

  function startStopwatchLoop() {
    if (swHandle) clearInterval(swHandle);
    swHandle = setInterval(() => {
      if (!swRunning) return;
      updateStopwatchDisplay(swBase + (Date.now() - swStart));
    }, 33);
  }

  function stopStopwatchLoop() {
    if (swHandle) { clearInterval(swHandle); swHandle = null; }
  }

  function updateStopwatchDisplay(elapsed) {
    const el = $('stopwatch-display');
    if (!el) return;
    const total = Math.floor(elapsed / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ms = Math.floor((elapsed % 1000) / 10);
    const core = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    el.textContent = core;
    el.appendChild(Utils.el('span', 'ms', '.' + pad(ms)));
  }

  function initStopwatch() {
    $('start-stopwatch').addEventListener('click', async () => {
      const result = await chrome.storage.local.get(['stopwatch']);
      const sw = result.stopwatch || {};
      const elapsed = sw.elapsed || 0;
      await chrome.storage.local.set({
        stopwatch: { running: true, elapsed, startTime: Date.now() }
      });
      state.laps = [];
      renderLaps();
      swRunning = true;
      swBase = elapsed;
      swStart = Date.now();
      $('start-stopwatch').disabled = true;
      $('pause-stopwatch').disabled = false;
      $('lap-stopwatch').disabled = false;
      startStopwatchLoop();
    });

    $('pause-stopwatch').addEventListener('click', async () => {
      const elapsed = swBase + (Date.now() - swStart);
      await chrome.storage.local.set({
        stopwatch: { running: false, elapsed, startTime: 0 }
      });
      swRunning = false;
      swBase = elapsed;
      stopStopwatchLoop();
      updateStopwatchDisplay(elapsed);
      $('start-stopwatch').disabled = false;
      $('pause-stopwatch').disabled = true;
      $('lap-stopwatch').disabled = true;
    });

    $('lap-stopwatch').addEventListener('click', () => {
      const el = $('stopwatch-display');
      const text = el ? el.firstChild.textContent : '00:00';
      state.laps.unshift(text);
      renderLaps();
    });

    $('reset-stopwatch').addEventListener('click', async () => {
      await chrome.storage.local.set({ stopwatch: { running: false, elapsed: 0, startTime: 0 } });
      swRunning = false;
      swBase = 0;
      stopStopwatchLoop();
      state.laps = [];
      renderLaps();
      updateStopwatchDisplay(0);
      $('start-stopwatch').disabled = false;
      $('pause-stopwatch').disabled = true;
      $('lap-stopwatch').disabled = true;
    });
  }

  function renderLaps() {
    const host = $('laps-list');
    const head = $('laps-head');
    if (!host) return;
    host.innerHTML = '';
    if (head) head.hidden = !state.laps.length;
    if (!state.laps.length) return;
    state.laps.forEach((lap, i) => {
      const item = Utils.el('div', 'lap-item');
      item.appendChild(Utils.el('span', null, 'دور ' + fa(state.laps.length - i)));
      item.appendChild(Utils.el('span', null, lap));
      host.appendChild(item);
    });
  }

  /* ==================== یادآورها ==================== */
  function initReminders() {
    const daysHost = $('rem-days');
    WEEKDAY_NAMES.forEach((name, index) => {
      const chip = Utils.el('button', 'day-chip', name);
      chip.dataset.day = index;
      chip.type = 'button';
      chip.addEventListener('click', () => chip.classList.toggle('active'));
      daysHost.appendChild(chip);
    });

    $('rem-repeat').addEventListener('change', updateRepeatFields);
    $('add-rem').addEventListener('click', addReminder);

    $('test-notif').addEventListener('click', async () => {
      const res = await send('test_notification');
      Utils.toast(res.success ? 'نوتیفیکیشن تست ارسال شد' : 'ارسال نوتیفیکیشن ناموفق بود',
        res.success ? 'success' : 'error');
    });

    const testRemBtn = $('test-reminder');
    if (testRemBtn) {
      testRemBtn.addEventListener('click', async () => {
        testRemBtn.disabled = true;
        testRemBtn.textContent = 'در حال تست…';
        const res = await send('test_reminder');
        testRemBtn.disabled = false;
        testRemBtn.textContent = '🔔 تست یادآور';

        if (!res || !res.success) {
          Utils.toast('اجرای یادآور ناموفق بود', 'error', 5000);
          return;
        }
        if (res.baleSent) {
          Utils.toast('نوتیفیکیشن + پیام بله ارسال شد ✓', 'success', 6000);
        } else {
          Utils.toast('نوتیفیکیشن ارسال شد، ولی پیام بله نرفت: ' + (res.baleError || 'نامشخص'), 'warning', 8000);
        }
      });
    }

    $('reminders-list').addEventListener('click', onReminderAction);
  }

  function updateRepeatFields() {
    const repeat = $('rem-repeat').value;
    $('rem-date-group').hidden = repeat !== 'once';
    $('rem-days-group').hidden = repeat !== 'weekly';
  }

  async function addReminder() {
    const time = $('rem-time').value;
    const text = $('rem-text').value.trim();
    const repeat = $('rem-repeat').value;

    if (!time) { Utils.toast('ساعت یادآور را انتخاب کنید', 'warning'); return; }
    if (!text) { Utils.toast('متن یادآور را وارد کنید', 'warning'); return; }

    let days = [];
    if (repeat === 'weekly') {
      days = Array.from(document.querySelectorAll('#rem-days .day-chip.active'))
        .map((c) => parseInt(c.dataset.day, 10));
      if (!days.length) { Utils.toast('حداقل یک روز هفته را انتخاب کنید', 'warning'); return; }
    }

    let date = '';
    if (repeat === 'once') {
      const parsed = Jalali.parse($('rem-date').value.trim());
      if (!parsed) { Utils.toast('تاریخ شمسی نامعتبر است (مثال: ۱۴۰۵/۰۷/۲۹)', 'warning'); return; }
      date = jalaliToGregorianString(parsed.jy, parsed.jm, parsed.jd);
    }

    const res = await send('add_reminder', { reminderData: { time, text, repeat, days, date } });
    if (res.success) {
      $('rem-text').value = '';
      Utils.toast('یادآور اضافه شد', 'success');
      loadState();
    }
  }

  async function onReminderAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.dataset.action === 'toggle') {
      await send('toggle_reminder', { reminderId: id });
      loadState();
    } else if (btn.dataset.action === 'delete') {
      const ok = await Utils.confirmDialog({
        title: 'حذف یادآور',
        message: 'این یادآور حذف شود؟',
        okText: 'حذف'
      });
      if (ok) {
        await send('delete_reminder', { reminderId: id });
        Utils.toast('یادآور حذف شد', 'success');
        loadState();
      }
    }
  }

  function renderReminders() {
    const host = $('reminders-list');
    if (!host) return;
    host.innerHTML = '';

    if (!state.reminders.length) {
      const empty = Utils.el('div', 'empty-state');
      empty.appendChild(Utils.el('span', 'em', '🔔'));
      empty.appendChild(Utils.el('span', null, 'یادآوری ثبت نشده است'));
      host.appendChild(empty);
      return;
    }

    state.reminders.forEach((reminder) => {
      const item = Utils.el('div', 'reminder-item' + (reminder.enabled === false ? ' off' : ''));

      const info = Utils.el('div', 'reminder-info');
      info.appendChild(Utils.el('div', 'reminder-time', fa(reminder.time)));
      info.appendChild(Utils.el('div', 'reminder-text', reminder.text));

      const meta = Utils.el('div', 'reminder-meta');
      let extra = REPEAT_LABELS[reminder.repeat] || '';
      if (reminder.repeat === 'weekly' && Array.isArray(reminder.days) && reminder.days.length) {
        extra += ' — ' + reminder.days.map((d) => WEEKDAY_NAMES[d]).join('، ');
      }
      if (reminder.repeat === 'once' && reminder.date) {
        const parsed = Jalali.parse(reminder.date);
        extra += parsed ? ' — ' + Jalali.formatJalali(parsed.jy, parsed.jm, parsed.jd) : ' — ' + reminder.date;
      }
      const next = formatNextTrigger(reminder.nextTrigger);
      if (next && reminder.enabled !== false) extra += ' · ' + next;
      meta.textContent = extra;
      info.appendChild(meta);

      const actions = Utils.el('div', 'timer-actions');
      actions.style.flexDirection = 'row';

      const toggle = Utils.el('label', 'switch');
      toggle.title = reminder.enabled === false ? 'فعال‌سازی' : 'غیرفعال‌سازی';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = reminder.enabled !== false;
      checkbox.dataset.action = 'toggle';
      checkbox.dataset.id = reminder.id;
      toggle.appendChild(checkbox);
      toggle.appendChild(Utils.el('span', 'switch-ui'));

      const del = Utils.el('button', 'icon-action danger', '✕');
      del.dataset.action = 'delete';
      del.dataset.id = reminder.id;

      actions.appendChild(toggle);
      actions.appendChild(del);

      item.appendChild(info);
      item.appendChild(actions);
      host.appendChild(item);
    });
  }

  /* ==================== ابزارهای تاریخ ==================== */
  function initTools() {
    const tabs = document.querySelectorAll('.subtab');
    const contents = document.querySelectorAll('.tool-content');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        contents.forEach((c) => { c.hidden = c.id !== 'tool-' + tab.dataset.tool; });
      });
    });

    $('calculate-age').addEventListener('click', calculateAge);
    $('jalali-to-gregorian').addEventListener('click', jalaliToGregorian);
    $('gregorian-to-jalali').addEventListener('click', gregorianToJalali);
    $('calculate-diff').addEventListener('click', calculateDateDiff);

    $('modal-close').addEventListener('click', closeModal);
    $('result-modal').addEventListener('click', (e) => { if (e.target === $('result-modal')) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  }

  function showModal(title, contentNode) {
    $('modal-title').textContent = title;
    const body = $('modal-body');
    body.innerHTML = '';
    body.appendChild(contentNode);
    $('result-modal').classList.add('open');
  }

  function closeModal() {
    $('result-modal').classList.remove('open');
  }

  function resultGrid(items) {
    const grid = Utils.el('div', 'modal-grid');
    items.forEach(([label, value]) => {
      const box = Utils.el('div', 'modal-result-item');
      box.appendChild(Utils.el('span', 'label', label));
      box.appendChild(Utils.el('span', 'value', value));
      grid.appendChild(box);
    });
    return grid;
  }

  function calculateAge() {
    let birth = null;
    let birthType = '';

    const jalaliInput = $('birth-jalali').value.trim();
    if (jalaliInput) {
      const parsed = Jalali.parse(jalaliInput);
      if (!parsed) { Utils.toast('تاریخ شمسی نامعتبر است', 'error'); return; }
      const g = Jalali.toGregorian(parsed.jy, parsed.jm, parsed.jd);
      birth = new Date(g.gy, g.gm - 1, g.gd);
      birthType = 'شمسی';
    } else if ($('birth-gregorian').value) {
      const parts = $('birth-gregorian').value.split('-');
      birth = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      birthType = 'میلادی';
    }

    if (!birth || isNaN(birth.getTime())) { Utils.toast('تاریخ تولد را وارد کنید', 'warning'); return; }

    const now = new Date();
    if (birth > now) { Utils.toast('تاریخ تولد نمی‌تواند در آینده باشد', 'error'); return; }

    let years = now.getFullYear() - birth.getFullYear();
    let months = now.getMonth() - birth.getMonth();
    let days = now.getDate() - birth.getDate();
    if (days < 0) { months--; days += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
    if (months < 0) { years--; months += 12; }

    const diffMs = now - birth;
    const totalDays = Math.floor(diffMs / 86400000);
    const totalHours = Math.floor(diffMs / 3600000);
    const totalMinutes = Math.floor(diffMs / 60000);
    const totalSeconds = Math.floor(diffMs / 1000);
    const totalWeeks = Math.floor(totalDays / 7);
    const totalMonths = years * 12 + months;

    const wrap = Utils.el('div');

    const highlight = Utils.el('div', 'modal-highlight');
    highlight.appendChild(Utils.el('span', 'big-number', fa(years)));
    highlight.appendChild(Utils.el('span', 'label', '🎂 سن شما'));
    wrap.appendChild(highlight);

    const row1 = Utils.el('div', 'modal-date-row');
    row1.appendChild(Utils.el('span', 'label', '📅 تاریخ تولد'));
    const g = Jalali.toJalali(birth.getFullYear(), birth.getMonth() + 1, birth.getDate());
    row1.appendChild(Utils.el('span', 'value', Jalali.formatJalali(g.jy, g.jm, g.jd) + ' (' + birthType + ')'));
    wrap.appendChild(row1);

    const row2 = Utils.el('div', 'modal-date-row');
    row2.appendChild(Utils.el('span', 'label', '📆 سن دقیق'));
    row2.appendChild(Utils.el('span', 'value', `${fa(years)} سال، ${fa(months)} ماه و ${fa(days)} روز`));
    wrap.appendChild(row2);

    wrap.appendChild(resultGrid([
      ['📊 به ماه', fa(totalMonths.toLocaleString('en-US'))],
      ['📊 به هفته', fa(totalWeeks.toLocaleString('en-US'))],
      ['📊 به روز', fa(totalDays.toLocaleString('en-US'))],
      ['📊 به ساعت', fa(totalHours.toLocaleString('en-US'))],
      ['📊 به دقیقه', fa(totalMinutes.toLocaleString('en-US'))],
      ['📊 به ثانیه', fa(totalSeconds.toLocaleString('en-US'))]
    ]));

    const next = nextBirthday(birth);
    const nb = Utils.el('div', 'modal-next-birthday');
    nb.appendChild(Utils.el('span', 'label', '🎂 تولد بعدی'));
    nb.appendChild(Utils.el('div', 'value', next));
    wrap.appendChild(nb);

    showModal('🎂 نتیجهٔ محاسبهٔ سن', wrap);
  }

  function nextBirthday(birth) {
    const now = new Date();
    let next = new Date(now.getFullYear(), birth.getMonth(), birth.getDate());
    if (next < now) next = new Date(now.getFullYear() + 1, birth.getMonth(), birth.getDate());
    const diff = next - now;
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    return `${fa(days)} روز و ${fa(hours)} ساعت دیگر`;
  }

  function jalaliToGregorian() {
    const parsed = Jalali.parse($('jalali-date').value.trim());
    if (!parsed) { Utils.toast('تاریخ شمسی نامعتبر است', 'error'); return; }
    const g = Jalali.toGregorian(parsed.jy, parsed.jm, parsed.jd);
    const wrap = Utils.el('div');
    const row = Utils.el('div', 'modal-date-row');
    row.appendChild(Utils.el('span', 'label', '📅 معادل میلادی'));
    row.appendChild(Utils.el('span', 'value', Jalali.formatGregorian(g.gy, g.gm, g.gd)));
    wrap.appendChild(row);
    const row2 = Utils.el('div', 'modal-date-row');
    row2.appendChild(Utils.el('span', 'label', '📝 نوشتاری'));
    row2.appendChild(Utils.el('span', 'value', Jalali.formatGregorianLong(g.gy, g.gm, g.gd)));
    wrap.appendChild(row2);
    showModal('📅 تبدیل تاریخ', wrap);
  }

  function gregorianToJalali() {
    const value = $('gregorian-date').value;
    if (!value) { Utils.toast('تاریخ میلادی را انتخاب کنید', 'warning'); return; }
    const parts = value.split('-');
    const j = Jalali.toJalali(+parts[0], +parts[1], +parts[2]);
    const wrap = Utils.el('div');
    const row = Utils.el('div', 'modal-date-row');
    row.appendChild(Utils.el('span', 'label', '📅 معادل شمسی'));
    row.appendChild(Utils.el('span', 'value', Jalali.formatJalali(j.jy, j.jm, j.jd)));
    wrap.appendChild(row);
    const row2 = Utils.el('div', 'modal-date-row');
    row2.appendChild(Utils.el('span', 'label', '📝 نوشتاری'));
    row2.appendChild(Utils.el('span', 'value', Jalali.formatJalaliLong(j.jy, j.jm, j.jd)));
    wrap.appendChild(row2);
    showModal('📅 تبدیل تاریخ', wrap);
  }

  function calculateDateDiff() {
    const d1 = readDate($('diff1-jalali').value, $('diff1-gregorian').value);
    const d2 = readDate($('diff2-jalali').value, $('diff2-gregorian').value);
    if (!d1 || !d2) { Utils.toast('هر دو تاریخ را وارد کنید', 'warning'); return; }
    if (d1.date > d2.date) { Utils.toast('تاریخ اول باید قبل از تاریخ دوم باشد', 'error'); return; }

    const diffMs = d2.date - d1.date;
    const diffDays = Math.floor(diffMs / 86400000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffWeeks = Math.floor(diffDays / 7);

    let years = d2.date.getFullYear() - d1.date.getFullYear();
    let months = d2.date.getMonth() - d1.date.getMonth();
    let days = d2.date.getDate() - d1.date.getDate();
    if (days < 0) { months--; days += new Date(d2.date.getFullYear(), d2.date.getMonth(), 0).getDate(); }
    if (months < 0) { years--; months += 12; }

    const wrap = Utils.el('div');
    const highlight = Utils.el('div', 'modal-highlight');
    highlight.appendChild(Utils.el('span', 'big-number', fa(diffDays.toLocaleString('en-US'))));
    highlight.appendChild(Utils.el('span', 'label', '📆 روز فاصله'));
    wrap.appendChild(highlight);

    [[d1, 'تاریخ اول'], [d2, 'تاریخ دوم']].forEach(([item, label]) => {
      const row = Utils.el('div', 'modal-date-row');
      row.appendChild(Utils.el('span', 'label', '📅 ' + label));
      row.appendChild(Utils.el('span', 'value', item.label + ' (' + item.type + ')'));
      wrap.appendChild(row);
    });

    const exact = Utils.el('div', 'modal-date-row');
    exact.appendChild(Utils.el('span', 'label', '📊 فاصلهٔ دقیق'));
    exact.appendChild(Utils.el('span', 'value', `${fa(years)} سال، ${fa(months)} ماه و ${fa(days)} روز`));
    wrap.appendChild(exact);

    wrap.appendChild(resultGrid([
      ['📊 به سال', fa(Math.floor(diffDays / 365.25).toLocaleString('en-US'))],
      ['📊 به ماه', fa(Math.floor(diffDays / 30.44).toLocaleString('en-US'))],
      ['📊 به هفته', fa(diffWeeks.toLocaleString('en-US'))],
      ['📊 به روز', fa(diffDays.toLocaleString('en-US'))],
      ['📊 به ساعت', fa(diffHours.toLocaleString('en-US'))],
      ['📊 به دقیقه', fa(diffMinutes.toLocaleString('en-US'))]
    ]));

    const total = Utils.el('div', 'modal-result-item full-width');
    total.appendChild(Utils.el('span', 'label', '📊 به ثانیه'));
    total.appendChild(Utils.el('span', 'value', fa(diffSeconds.toLocaleString('en-US'))));
    const grid = wrap.querySelector('.modal-grid');
    if (grid) grid.appendChild(total);

    showModal('📆 فاصلهٔ دو تاریخ', wrap);
  }

  function readDate(jalaliValue, gregorianValue) {
    if (jalaliValue && jalaliValue.trim()) {
      const parsed = Jalali.parse(jalaliValue.trim());
      if (!parsed) return null;
      const g = Jalali.toGregorian(parsed.jy, parsed.jm, parsed.jd);
      return {
        date: new Date(g.gy, g.gm - 1, g.gd),
        label: Jalali.formatJalali(parsed.jy, parsed.jm, parsed.jd),
        type: 'شمسی'
      };
    }
    if (gregorianValue) {
      const parts = gregorianValue.split('-');
      const gy = +parts[0], gm = +parts[1], gd = +parts[2];
      const j = Jalali.toJalali(gy, gm, gd);
      return {
        date: new Date(gy, gm - 1, gd),
        label: Jalali.formatJalali(j.jy, j.jm, j.jd),
        type: 'میلادی'
      };
    }
    return null;
  }

  /* ==================== تنظیمات ==================== */
  function initSettings() {
    $('save-bale').addEventListener('click', saveBaleSettings);
    $('check-bale').addEventListener('click', () => checkBale(false));
    $('test-bale').addEventListener('click', testBale);
    $('pair-start').addEventListener('click', startPair);
    $('pair-open').addEventListener('click', openPairLink);
    $('pair-copy').addEventListener('click', copyPairCode);
    $('pair-unlink').addEventListener('click', unlinkPair);
    $('pair-code').addEventListener('click', copyPairCode);
    $('pair-cmd').addEventListener('click', async () => {
      const text = $('pair-cmd').textContent.trim();
      try {
        await navigator.clipboard.writeText(text);
        Utils.toast('کپی شد: ' + text, 'success', 2500);
      } catch (e) { /* بی‌اهمیت */ }
    });
    const diagBtn = $('diag-refresh');
    if (diagBtn) diagBtn.addEventListener('click', () => {
      refreshDiagnostics();
      Utils.toast('وضعیت سرور بررسی شد', 'info', 2000);
    });
    $('copy-bot').addEventListener('click', copyBotUsername);
    $('bale-suggest-apply').addEventListener('click', applySuggestion);
    $('test-server').addEventListener('click', testServer);
    $('test-bale-raw').addEventListener('click', testBaleRaw);

    const toggles = [
      ['opt-sound', 'soundEnabled'],
      ['opt-notify', 'notifyOnTimerEnd'],
      ['opt-overlay', 'showOverlay'],
      ['opt-title', 'titleCountdown'],
      ['opt-badge', 'badgeEnabled'],
      ['opt-sync', 'syncEnabled'],
      ['opt-pomo-autostart', 'pomodoro.autoStart'],
      ['opt-focus-autostart', 'focus.autoStart']
    ];
    toggles.forEach(([id, key]) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', async (e) => {
        const value = e.target.checked;
        let patch;
        if (key.includes('.')) {
          const [group, field] = key.split('.');
          patch = { [group]: { ...(state.settings[group] || {}), [field]: value } };
        } else {
          patch = { [key]: value };
        }
        await send('save_settings', { patch });
        // به‌روزرسانی محلی
        Object.entries(patch).forEach(([k, v]) => { state.settings[k] = v; });
        Utils.toast('تنظیمات ذخیره شد', 'success', 1400);
      });
    });

    $('opt-theme').addEventListener('change', async (e) => {
      await send('save_settings', { patch: { theme: e.target.value } });
      state.settings.theme = e.target.value;
      applyTheme();
    });

    $('focus-sites').addEventListener('change', async (e) => {
      const sites = e.target.value.split(/[,\n،]/).map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
      await send('save_settings', { patch: { focus: { ...(state.settings.focus || {}), sites } } });
      state.settings.focus = { ...(state.settings.focus || {}), sites };
      Utils.toast('سایت‌های مسدود ذخیره شد', 'success', 1400);
    });

    ['pomo-focus-2', 'pomo-break-2', 'pomo-sessions-2'].forEach((id) => {
      $(id).addEventListener('change', async () => {
        const pomodoro = {
          focus: parseInt($('pomo-focus-2').value, 10) || 25,
          break: parseInt($('pomo-break-2').value, 10) || 5,
          sessions: parseInt($('pomo-sessions-2').value, 10) || 4
        };
        await send('save_settings', { patch: { pomodoro } });
        state.settings.pomodoro = pomodoro;
        renderPomodoro();
        Utils.toast('تنظیمات پومودورو ذخیره شد', 'success', 1400);
      });
    });

    $('export-data').addEventListener('click', exportData);
    $('import-data').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', importData);
    $('reset-data').addEventListener('click', resetData);
  }

  function setValue(id, value) {
    const el = $(id);
    if (!el) return;
    if (document.activeElement === el) return;
    el.value = value == null ? '' : value;
  }

  function renderSettingsForm() {
    const s = state.settings;
    setValue('bale-username', s.username || '');
    setValue('focus-sites', ((s.focus || {}).sites || []).join(', '));
    renderBotIdentity({ username: s.botUsername || CONFIG.botUsername });

    // دکمهٔ تست سرور فقط در حالت «واسط» معنا دارد
    const serverRow = $('server-test-row');
    if (serverRow) serverRow.hidden = baleMode() !== 'proxy';

    renderBaleMode();
    $('opt-sound').checked = s.soundEnabled !== false;
    $('opt-notify').checked = s.notifyOnTimerEnd !== false;
    $('opt-overlay').checked = s.showOverlay !== false;
    $('opt-title').checked = s.titleCountdown !== false;
    $('opt-badge').checked = s.badgeEnabled !== false;
    $('opt-sync').checked = !!s.syncEnabled;
    $('opt-theme').value = s.theme || 'auto';
    const pomo = s.pomodoro || {};
    $('opt-pomo-autostart').checked = pomo.autoStart !== false;
    $('opt-focus-autostart').checked = (s.focus || {}).autoStart !== false;
  }

  async function saveBaleSettings() {
    const username = $('bale-username').value.trim();
    await send('save_settings', { patch: { username } });
    state.settings.username = username;
    Utils.toast(username ? 'یوزرنیم ذخیره شد' : 'یوزرنیم پاک شد', 'success');
    checkBale(true);
  }

  /** نمایش هویت ربات (نام و یوزرنیم) */
  function renderBotIdentity(bot) {
    const handle = $('bot-handle');
    const identity = $('bot-identity');
    if (!handle) return;

    const username = (bot && bot.username) || state.settings.botUsername || CONFIG.botUsername || '';
    const name = (bot && bot.firstName) || '';

    if (username) {
      handle.textContent = username.startsWith('@') ? username : '@' + username;
      handle.classList.remove('unknown');
    } else {
      handle.textContent = 'نام ربات مشخص نشده — از توسعه‌دهنده بپرسید';
      handle.classList.add('unknown');
    }

    if (identity) {
      identity.title = name ? name + ' — ' + username : username;
    }
  }

  async function copyBotUsername() {
    const handle = $('bot-handle');
    const text = handle ? handle.textContent.trim() : '';
    if (!text || text.includes('نامشخص')) {
      Utils.toast('نام ربات مشخص نیست', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      Utils.toast('کپی شد: ' + text, 'success', 2000);
    } catch (e) {
      Utils.toast('کپی ناموفق بود', 'error');
    }
  }

  /** اگر یوزرنیم اشتباه وارد شده، یوزرنیم درست را پیشنهاد می‌دهد */
  function renderSuggestion(seen) {
    const box = $('bale-suggest');
    const btn = $('bale-suggest-apply');
    if (!box || !btn) return;

    const current = ($('bale-username').value || '').trim().replace(/^@+/, '').toLowerCase();
    const candidates = (seen || []).filter((u) => u && u !== current);

    if (!candidates.length) {
      box.hidden = true;
      return;
    }

    btn.textContent = '@' + candidates[0];
    btn.dataset.username = candidates[0];
    box.hidden = false;
  }

  async function applySuggestion() {
    const btn = $('bale-suggest-apply');
    const username = btn ? btn.dataset.username : '';
    if (!username) return;
    $('bale-username').value = '@' + username;
    await saveBaleSettings();
    Utils.toast('یوزرنیم اعمال شد', 'success');
  }

  /** تست خام API بله — نمایش دقیق پاسخ سرور */
  async function testBaleRaw() {
    const log = $('server-log');
    if (log) { log.hidden = false; log.textContent = 'در حال تست…'; }

    const res = await send('test_bale_raw');
    if (!log) return;

    if (!res.results) {
      log.textContent = 'خطا: ' + (res.error || 'نامشخص');
      return;
    }

    const lines = res.results.map((r) =>
      `${r.ok ? '✓' : '✗'} ${r.variant}  →  HTTP ${r.status}\n   ${r.body}`
    );
    log.textContent = `کاربر: ${res.username}\n` +
      (res.resolvedChatId ? `chat_id: ${res.resolvedChatId}\n` : '') +
      '─────────────────\n' + lines.join('\n');

    if (res.success) {
      Utils.toast('ارسال موفق بود ✓', 'success');
    } else {
      Utils.toast('همهٔ روش‌ها ناموفق بود', 'error', 5000);
    }
  }

  /** تست خام سرور (بدون preflight) — برای عیب‌یابی */
  async function testServer() {
    const log = $('server-log');
    if (log) { log.hidden = false; log.textContent = 'در حال تست…'; }

    const res = await send('test_server');
    if (!log) return;

    if (res.success) {
      log.textContent = `OK ${res.status} — ${res.time}ms\n${res.body}`;
      Utils.toast('سرور پاسخ داد ✓', 'success');
    } else {
      log.textContent = [
        '✗ خطا',
        `URL: ${res.url || '-'}`,
        `نوع: ${res.error || '-'}`,
        `پیام: ${res.message || '-'}`,
        `زمان: ${res.time || 0}ms`
      ].join('\n');
      Utils.toast('سرور پاسخ نداد', 'error');
    }
  }

  async function checkBale(silent) {
    const status = $('bale-status');
    if (status) { status.textContent = 'بررسی…'; status.className = 'status-pill'; }

    const res = await send('check_bale');
    if (res && res.bot) renderBotIdentity(res.bot);
    renderSuggestion(res && res.seen);
    if (!status) return;

    if (res.ok && res.linked) {
      status.textContent = 'متصل ✓';
      status.className = 'status-pill ok';
      pairInfo = {
        username: (state.settings.username || '').replace(/^@+/, ''),
        chatId: res.chatId ? String(res.chatId) : pairInfo.chatId
      };
      renderPairState('linked');
      if (!silent) Utils.toast('ارتباط با بله برقرار است ✓', 'success', 5000);
    } else if (res.ok && !res.linked) {
      status.textContent = 'وصل نشده';
      status.className = 'status-pill warn';
      // اگر کد اتصال در انتظار تأیید است، وضعیت «در انتظار» را خراب نکنیم
      if (pairMode !== 'waiting') renderPairState('none');
      if (!silent) {
        Utils.toast('هنوز به بله وصل نیست — روی «ساخت کد اتصال» بزنید', 'warning', 6000);
      }
    } else {
      status.textContent = res.error === 'not_configured' ? 'تنظیم‌نشده' : 'خطا';
      status.className = 'status-pill err';
      if (!silent) Utils.toast(res.message || 'ارتباط برقرار نشد', 'error');
    }
  }

  /* ==================== اتصال بله (Pairing) ==================== */
  let pairPollHandle = null;
  let pairLink = '';
  let pairMode = 'none';
  let pairInfo = { username: '', chatId: '' };

  const HERO = {
    none: {
      cls: 'is-off', icon: '🔌',
      title: 'به بله وصل نیستید',
      sub: 'یک اتصال یک‌باره، اعلان تایمرها و کنترل از بله را فعال می‌کند'
    },
    waiting: {
      cls: 'is-wait', icon: '⏳',
      title: 'در انتظار تأیید در بله',
      sub: 'کد را در بله برای ربات بفرستید — این صفحه خودش متوجه می‌شود'
    },
    linked: {
      cls: 'is-on', icon: '✅',
      title: 'به بله متصل هستید',
      sub: 'تایمرها و یادآورها به بله می‌آیند و می‌توانید از آنجا کنترل کنید'
    },
    expired: {
      cls: 'is-err', icon: '⌛',
      title: 'کد منقضی شد',
      sub: 'کدها ۱۵ دقیقه اعتبار دارند — یک کد تازه بسازید'
    },
    error: {
      cls: 'is-err', icon: '⚠️',
      title: 'اتصال به سرور برقرار نشد',
      sub: 'اتصال اینترنت یا تنظیمات سرور را بررسی کنید'
    }
  };

  /** نمایش وضعیت اتصال: none | waiting | linked | expired | error */
  function renderPairState(mode) {
    pairMode = mode;
    const hero = HERO[mode] || HERO.none;

    const heroEl = $('bale-hero');
    if (heroEl) {
      heroEl.className = 'bale-hero ' + hero.cls;
      $('bale-hero-icon').textContent = hero.icon;
      $('bale-hero-title').textContent = hero.title;
      $('bale-hero-sub').textContent = hero.sub;
    }

    // پنل‌های اقدام
    const idle = $('bale-action-idle');
    const wait = $('bale-action-wait');
    const linked = $('bale-action-linked');
    if (idle) idle.hidden = mode !== 'none' && mode !== 'expired';
    if (wait) wait.hidden = mode !== 'waiting';
    if (linked) linked.hidden = mode !== 'linked';

    // نوار مراحل
    const steps = $('bale-steps');
    if (steps) steps.hidden = mode === 'linked';
    const activeStep = mode === 'waiting' ? 2 : 1;
    steps && steps.querySelectorAll('.bale-step').forEach((el) => {
      const n = parseInt(el.dataset.step, 10);
      el.classList.toggle('is-done', mode === 'linked' || (mode === 'waiting' && n < 2));
      el.classList.toggle('is-active', mode !== 'linked' && n === activeStep);
    });

    // کارت حساب متصل
    if (mode === 'linked') {
      const name = $('bale-linked-name');
      const cid = $('bale-linked-id');
      if (name) name.textContent = pairInfo.username ? '@' + pairInfo.username : 'حساب بله';
      if (cid) cid.textContent = pairInfo.chatId ? 'chat_id ' + pairInfo.chatId : 'chat_id —';
    }

    if (mode !== 'waiting' && pairPollHandle) {
      clearInterval(pairPollHandle);
      pairPollHandle = null;
    }
  }

  /** رنگ‌آمیزی یک ردیف تشخیص */
  function setDiag(key, state, text) {
    const row = document.querySelector(`.diag-row[data-k="${key}"]`);
    if (!row) return;
    row.className = 'diag-row' + (state ? ' ' + state : '');
    const b = row.querySelector('b');
    if (b) b.textContent = text;
  }

  /** لیست endpointهای ممکن — چند پورت، چون ۴۴۳ ممکن است فیلتر باشد */
  function endpointCandidates(base) {
    const m = String(base).match(/^(https?:\/\/)([^/:]+)(?::\d+)?/);
    if (!m) return [base];
    const [, scheme, host] = m;
    const ports = Array.isArray(CONFIG.proxyFallbackPorts) && CONFIG.proxyFallbackPorts.length
      ? CONFIG.proxyFallbackPorts
      : [2053, 2087, 443];

    const urls = ports.map((p) => (Number(p) === 443 ? `${scheme}${host}` : `${scheme}${host}:${p}`));
    if (!urls.includes(base)) urls.push(base);

    let saved = '';
    try { saved = localStorage.getItem('baleEndpoint') || ''; } catch (e) { /* noop */ }
    if (saved && urls.includes(saved)) return [saved, ...urls.filter((u) => u !== saved)];
    return urls;
  }

  /** خواندن /health و پر کردن جدول تشخیص */
  async function refreshDiagnostics() {
    const base = String(CONFIG.proxyUrl || '').replace(/\/+$/, '');
    if (!base) {
      ['server', 'token', 'kv', 'hook'].forEach((k) => setDiag(k, 'bad', '—'));
      const sum = $('diag-summary');
      if (sum) sum.textContent = 'تنظیم نشده';
      return;
    }

    const candidates = endpointCandidates(base);
    let h = null;
    let usedBase = '';
    let lastErr = null;

    for (let round = 0; round < 2 && !h; round++) {
      for (const ep of candidates) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(ep + '/health', { signal: controller.signal, cache: 'no-store' });
          clearTimeout(timer);
          h = await res.json();
          usedBase = ep;
          try { localStorage.setItem('baleEndpoint', ep); } catch (e) { /* noop */ }
          break;
        } catch (e) {
          clearTimeout(timer);
          lastErr = e;
        }
      }
    }

    if (h) {
      setDiag('server', 'ok', 'فعال');
      setDiag('token', h.tokenConfigured ? 'ok' : 'bad', h.tokenConfigured ? 'ثبت شده' : 'ندارد');
      setDiag('kv', h.kvConfigured ? 'ok' : 'bad', h.kvConfigured ? 'متصل' : 'ندارد');
      setDiag('hook', h.webhookConfigured ? 'ok' : 'warn', h.webhookConfigured ? 'ثبت شده' : 'ثبت نشده');

      const all = h.tokenConfigured && h.kvConfigured && h.webhookConfigured;
      const sum = $('diag-summary');
      if (sum) {
        sum.textContent = all ? 'همه‌چیز سالم' : 'نیاز به بررسی';
        sum.style.color = all ? 'var(--success)' : 'var(--warning)';
      }
      if (h.bot && h.bot.username) renderBotIdentity(h.bot);

      const log = $('server-log');
      if (log && usedBase && usedBase !== base) {
        log.hidden = false;
        log.textContent = '✅ پورت جایگزین جواب داد:\n' + usedBase;
      }
      return;
    }

    setDiag('server', 'bad', 'بی‌پاسخ');
    setDiag('token', '', '—');
    setDiag('kv', '', '—');
    setDiag('hook', '', '—');
    const sum = $('diag-summary');
    if (sum) { sum.textContent = 'اتصال برقرار نشد'; sum.style.color = 'var(--danger)'; }

    const log = $('server-log');
    if (log) {
      log.hidden = false;
      log.textContent =
        '❌ اتصال به سرور برقرار نشد\n' +
        'آدرس‌های امتحان‌شده:\n' + candidates.map((u) => '  • ' + u).join('\n') + '\n' +
        'خطا: ' + ((lastErr && (lastErr.name || lastErr.message)) || 'unknown') + '\n\n' +
        'اگر همه شکست خوردند، یعنی شبکه‌ات به Cloudflare دسترسی ندارد.';
    }
  }

  /** وضعیت ذخیره‌شده را از storage بازسازی می‌کند */
  async function refreshPairState() {
    try {
      const stored = await chrome.storage.local.get(['baleChatId', 'baleLinkedUser', 'balePair']);
      if (stored.baleChatId) {
        pairInfo = { username: stored.baleLinkedUser || '', chatId: String(stored.baleChatId) };
        renderPairState('linked');
        return;
      }
      if (stored.balePair && stored.balePair.code) {
        pairLink = stored.balePair.deepLink || '';
        $('pair-code').textContent = stored.balePair.code;
        $('pair-cmd').textContent = stored.balePair.fallbackCommand || ('/start ' + stored.balePair.code);
        renderPairState('waiting');
        startPairPolling();
        return;
      }
      renderPairState('none');
    } catch (e) {
      renderPairState('none');
    }
  }

  function startPairPolling() {
    if (pairPollHandle) clearInterval(pairPollHandle);
    let tries = 0;

    pairPollHandle = setInterval(async () => {
      tries++;
      if (tries > 120) { renderPairState('expired'); return; }

      const res = await send('pair_check');
      if (!res) return;

      if (res.linked) {
        pairInfo = { username: res.username || '', chatId: String(res.chatId || '') };
        renderPairState('linked');
        if (res.username) {
          state.settings.username = '@' + res.username;
          setValue('bale-username', state.settings.username);
        }
        Utils.toast('حساب بله وصل شد ✓', 'success', 5000);
        checkBale(true);
        refreshDiagnostics();
      } else if (res.expired) {
        renderPairState('expired');
      }
    }, 3000);
  }

  async function startPair() {
    const btn = $('pair-start');
    if (btn) { btn.disabled = true; btn.textContent = 'در حال ساخت…'; }

    const res = await send('pair_start');

    if (btn) { btn.disabled = false; btn.textContent = '🔗 ساخت کد اتصال'; }

    if (!res || !res.ok) {
      renderPairState('error');
      Utils.toast((res && (res.message || res.error)) || 'ساخت کد اتصال ناموفق بود', 'error', 6000);
      return;
    }

    pairLink = res.deepLink || '';
    $('pair-code').textContent = res.code;
    $('pair-cmd').textContent = res.fallbackCommand || ('/start ' + res.code);

    renderPairState('waiting');
    Utils.toast('کد ساخته شد — در بله باز کنید', 'success', 4000);
    startPairPolling();
  }

  async function openPairLink() {
    if (!pairLink) {
      Utils.toast('لینک در دسترس نیست — کد را دستی در بله بفرستید', 'warning', 5000);
      return;
    }
    try {
      await chrome.tabs.create({ url: pairLink });
      window.close();
    } catch (e) {
      Utils.toast('باز کردن لینک ناموفق بود', 'error');
    }
  }

  async function copyPairCode() {
    const code = $('pair-code') ? $('pair-code').textContent.trim() : '';
    try {
      await navigator.clipboard.writeText(code);
      Utils.toast('کد کپی شد: ' + code, 'success', 2500);
    } catch (e) {
      Utils.toast('کپی ناموفق بود', 'error');
    }
  }

  async function unlinkPair() {
    await send('unlink_bale');
    pairLink = '';
    pairInfo = { username: '', chatId: '' };
    setValue('bale-username', '');
    state.settings.username = '';
    renderPairState('none');
    refreshDiagnostics();
    Utils.toast('اتصال قطع شد', 'success');
  }


  async function testBale() {
    await saveBaleSettings();

    // ربات مستقیماً برای کاربر پیام معرفی می‌فرستد
    const ping = await send('ping_bale');
    if (ping && ping.success) {
      renderBotIdentity({ username: ping.botUsername });
      Utils.toast('ربات برای شما پیام فرستاد ✓ (در بله ببینید)', 'success', 5000);
      return;
    }

    if (ping && (ping.error === 'user_not_started' || ping.error === 'not_linked')) {
      Utils.toast('اول روی «ساخت کد اتصال» بزنید تا ربات بتواند برایتان پیام بفرستد', 'warning', 7000);
      return;
    }

    if (ping && ping.error === 'timeout') {
      Utils.toast('پاسخی از سرور نرسید', 'error', 5000);
      return;
    }

    if (ping && ping.error === 'not_configured') {
      Utils.toast('توکن ربات در js/config.js تنظیم نشده است', 'error', 6000);
      return;
    }

    // خطای دقیق را در کادر پایین هم نشان می‌دهیم
    const log = $('server-log');
    if (log) {
      log.hidden = false;
      log.textContent = '❌ ' + (ping && (ping.message || ping.error) || 'ارسال ناموفق');
    }

    const res = await send('send_test_bale');
    if (res.success) {
      Utils.toast('پیام تست ارسال شد ✓', 'success');
    } else {
      Utils.toast(res.message || ('ارسال ناموفق: ' + (res.error || '')), 'error', 5000);
    }
  }

  function renderStats() {
    const host = $('stats-row');
    if (!host) return;
    host.innerHTML = '';
    const stats = state.stats || {};
    const focusMinutes = Math.floor((stats.focusSeconds || 0) / 60);
    const boxes = [
      [fa(stats.pomodoros || 0), 'پومودورو'],
      [fa(focusMinutes), 'دقیقه تمرکز'],
      [fa(stats.finishedTimers || 0), 'تایمر تمام‌شده']
    ];
    boxes.forEach(([value, label]) => {
      const box = Utils.el('div', 'stat-box');
      box.appendChild(Utils.el('b', null, value));
      box.appendChild(Utils.el('span', null, label));
      host.appendChild(box);
    });
  }

  async function exportData() {
    const res = await send('export_data');
    if (!res.success) return;
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'timery-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    Utils.toast('فایل خروجی ساخته شد', 'success');
  }

  async function importData(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const res = await send('import_data', { data });
      if (res.success) {
        Utils.toast('داده‌ها بازیابی شد', 'success');
        loadState();
      }
    } catch (error) {
      Utils.toast('فایل نامعتبر است', 'error');
    }
    e.target.value = '';
  }

  async function resetData() {
    const ok = await Utils.confirmDialog({
      title: 'پاک‌سازی داده‌ها',
      message: 'همهٔ تایمرها، یادآورها و آمار حذف می‌شوند. ادامه می‌دهید؟',
      okText: 'پاک کن'
    });
    if (!ok) return;
    await send('reset_data');
    Utils.toast('داده‌ها پاک شد', 'success');
    loadState();
  }

  /* ==================== درباره ==================== */
  function initAbout() {
    const repo = CONFIG.repoUrl || 'https://github.com/hkhoramir/timery';
    $('report-bug').addEventListener('click', () => {
      chrome.tabs.create({ url: repo + '/issues/new?labels=bug' });
    });
    $('suggest-feature').addEventListener('click', () => {
      chrome.tabs.create({ url: repo + '/issues/new?labels=enhancement' });
    });
  }

  /* ==================== شروع ==================== */
  document.addEventListener('DOMContentLoaded', async () => {
    const manifest = chrome.runtime.getManifest();
    const version = Utils.fa(manifest.version);
    $('about-version').textContent = 'نسخه ' + version;
    $('footer-version').textContent = 'نسخه ' + version;

    initTabs();
    initTheme();
    initClock();
    initTimer();
    initPomodoro();
    initStopwatch();
    initReminders();
    initTools();
    initSettings();
    initAbout();

    await loadState();
    await loadStopwatch();
    restoreTab();
    updateRepeatFields();

    tickHandle = setInterval(tickTimers, 1000);

    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      if (changes.timers || changes.reminders || changes.settings || changes.stats) {
        await loadState();
      }
    });

    // بررسی وضعیت اتصال بله در پس‌زمینه
    refreshPairState();
    refreshDiagnostics();
    setTimeout(() => checkBale(true), 600);
  });
})();
