/**
 * service_worker.js — Timery v3.2.0
 * ------------------------------------------------------------------
 *  ۱) منبع حقیقت تایمرها/یادآورها/کرنومتر
 *  ۲) اجرای دقیق پایان تایمر با chrome.alarms (مستقل از باز بودن تب)
 *  ۳) موتور پومودورو (چرخهٔ تمرکز/استراحت)
 *  ۴) حالت تمرکز با مسدودسازی سایت‌ها (declarativeNetRequest)
 *  ۵) ارتباط با واسط بله: ارسال پیام + دریافت فرمان‌ها
 *  ۶) سینک بین دستگاه‌ها با chrome.storage.sync
 */

'use strict';

// بارگذاری تنظیمات توسعه‌دهنده (آدرس واسط + کلید) — توسط توسعه‌دهنده پر می‌شود
importScripts('js/config.js', 'js/bale-messages.js');

/* ==================== کانفیگ ==================== */
const KEYS = {
  timers: 'timers',
  reminders: 'reminders',
  stopwatch: 'stopwatch',
  settings: 'settings',
  stats: 'stats'
};

const DEFAULT_SETTINGS = {
  theme: 'auto',
  username: '',              // فقط یوزرنیم بله کاربر
  soundEnabled: true,
  notifyOnTimerEnd: true,
  showOverlay: true,
  titleCountdown: true,
  badgeEnabled: true,
  syncEnabled: false,
  pomodoro: { focus: 25, break: 5, sessions: 4, autoStart: true },
  focus: { enabled: false, sites: ['instagram.com', 'youtube.com', 'telegram.org', 'x.com'], until: 0 }
};

const TIMER_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7'];
const CONFIG = (typeof TIMERY_CONFIG !== 'undefined' && TIMERY_CONFIG) || {};

/* ==================== ابزارها ==================== */
/**
 * fetch با مهلت زمانی (تا UI هرگز بی‌نهایت معلق نماند)
 *
 * نکتهٔ CORS: هدر سفارشی (مثل x-timery-key) باعث می‌شود مرورگر ابتدا
 * یک درخواست OPTIONS (preflight) بفرستد. اگر سرور به preflight پاسخ
 * درست ندهد، درخواست معلق می‌ماند. برای همین نسخهٔ دوم با ?key=
 * (بدون preflight) هم همیشه در دسترس است.
 */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** ساخت آدرس با پارامتر key (برای درخواست‌های بدون preflight) */
function withKey(base, path, key) {
  const separator = path.includes('?') ? '&' : '?';
  return base + path + separator + 'key=' + encodeURIComponent(key || '');
}

/**
 * لیست نقاط پایانی (endpoint) برای رسیدن به سرور.
 *
 * چرا چند پورت؟ در بعضی شبکه‌ها پورت ۴۴۳ برای دامنه‌های Cloudflare
 * به‌صورت تصادفی reset می‌شود، ولی پورت‌های جایگزین Cloudflare
 * (۲۰۵۳ و ۲۰۸۷) باز هستند. با چرخش بین این‌ها احتمال موفقیت
 * از ~۵۰٪ به بالای ۹۵٪ می‌رسد.
 *
 * می‌توانی با CONFIG.proxyFallbackPorts عوضش کنی.
 */
const DEFAULT_FALLBACK_PORTS = [2053, 2087, 443];

/** آخرین endpointی که جواب داد — دفعهٔ بعد اول همان را امتحان می‌کنیم */
let stickyBase = '';

function endpointsFor(base) {
  if (!base) return [];
  const m = String(base).match(/^(https?:\/\/)([^/:]+)(?::\d+)?/);
  if (!m) return [base];

  const [, scheme, host] = m;
  const ports = Array.isArray(CONFIG.proxyFallbackPorts) && CONFIG.proxyFallbackPorts.length
    ? CONFIG.proxyFallbackPorts
    : DEFAULT_FALLBACK_PORTS;

  const urls = ports.map((p) => (Number(p) === 443 ? `${scheme}${host}` : `${scheme}${host}:${p}`));
  // اگر آدرس خودش پورت داشت، همان را هم اضافه کن
  if (!urls.includes(base)) urls.push(base);

  // آخرین موفق، اول صف
  if (stickyBase && urls.includes(stickyBase)) {
    return [stickyBase, ...urls.filter((u) => u !== stickyBase)];
  }
  return urls;
}

/** ارسال درخواست به سرور — چند پورت، چند تلاش
 *   ۱) با هدر x-timery-key  (سریع، ولی preflight دارد)
 *   ۲) با ?key= و متن ساده   (بدون preflight → بدون ریسک گیر کردن CORS)
 */
async function callWorker(path, options, timeoutMs) {
  const bases = endpointsFor(proxyBase());
  if (!bases.length) throw new Error('proxy_not_configured');

  let lastError;
  for (let round = 0; round < 2; round++) {
    for (const base of bases) {
      try {
        const result = await callWorkerOnce(base, path, options, timeoutMs);
        stickyBase = base;
        return result;
      } catch (e) {
        lastError = e;
      }
    }
  }
  throw lastError;
}

async function callWorkerOnce(base, path, options, timeoutMs) {
  const key = baleKey();
  const isPost = !!(options && options.method === 'POST');
  const body = options && options.body;

  // تلاش اول: با هدر
  try {
    const res = await fetchWithTimeout(base + path, {
      ...(options || {}),
      headers: { ...((options && options.headers) || {}), 'x-timery-key': key }
    }, timeoutMs || 15000);
    return { res, usedQueryKey: false };
  } catch (firstError) {
    // تلاش دوم: بدون preflight
    try {
      const res = await fetchWithTimeout(withKey(base, path, key), {
        method: isPost ? 'POST' : 'GET',
        headers: isPost ? { 'Content-Type': 'text/plain;charset=UTF-8' } : {},
        body: isPost ? body : undefined
      }, timeoutMs || 15000);
      return { res, usedQueryKey: true };
    } catch (secondError) {
      throw firstError && firstError.name === 'AbortError' ? firstError : secondError;
    }
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

function fa(value) {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return String(value).replace(/[0-9]/g, (d) => persian[+d]);
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** برچسب خوانا برای زمان اجرای بعدی یادآور */
function formatNextTriggerLabel(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  const time = `${fa(pad(d.getHours()))}:${fa(pad(d.getMinutes()))}`;

  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()) -
      new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000
  );

  if (dayDiff === 0) return 'امروز ' + time;
  if (dayDiff === 1) return 'فردا ' + time;
  if (dayDiff === 2) return 'پس‌فردا ' + time;
  return `${fa(dayDiff)} روز دیگر — ${time}`;
}

/* ==================== تنظیمات ==================== */
async function getSettings() {
  const result = await chrome.storage.local.get(KEYS.settings);
  const stored = result[KEYS.settings] || {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...(stored.pomodoro || {}) },
    focus: { ...DEFAULT_SETTINGS.focus, ...(stored.focus || {}) }
  };
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  if (next.syncEnabled) await pushToSync();
  return next;
}

/* ==================== تایمرها ==================== */
async function getTimers() {
  const result = await chrome.storage.local.get(KEYS.timers);
  return Array.isArray(result[KEYS.timers]) ? result[KEYS.timers] : [];
}

async function saveTimers(timers) {
  await chrome.storage.local.set({ [KEYS.timers]: timers });
  const settings = await getSettings();
  if (settings.syncEnabled) await pushToSync();
}

function remainingOf(timer) {
  if (timer.paused) return Math.max(0, timer.remaining || 0);
  return Math.max(0, Math.floor((timer.endTime - Date.now()) / 1000));
}

function serializeTimer(timer) {
  return {
    id: timer.id,
    title: timer.title,
    totalSeconds: timer.totalSeconds,
    endTime: timer.endTime,
    remaining: remainingOf(timer),
    paused: !!timer.paused,
    running: !timer.paused,
    color: timer.color,
    kind: timer.kind || 'normal',
    createdAt: timer.createdAt
  };
}

async function startTimer(data) {
  const timers = await getTimers();
  const totalSeconds = Math.max(1, Math.round(data.totalSeconds || 0));
  const id = data.id || uid('timer');
  const timer = {
    id,
    title: (data.title || '').trim() || `تایمر ${formatClock(totalSeconds)}`,
    totalSeconds,
    endTime: Date.now() + totalSeconds * 1000,
    remaining: totalSeconds,
    paused: false,
    color: data.color || TIMER_COLORS[timers.length % TIMER_COLORS.length],
    kind: data.kind || 'normal',
    createdAt: Date.now()
  };

  timers.push(timer);
  await saveTimers(timers);
  await scheduleTimerAlarm(timer);
  await afterTimerChange();
  return timer;
}

async function scheduleTimerAlarm(timer) {
  const name = 'timer:' + timer.id;
  await chrome.alarms.clear(name);
  if (timer.paused) return;
  await chrome.alarms.create(name, { when: timer.endTime });
}

async function toggleTimer(id) {
  const timers = await getTimers();
  const timer = timers.find((t) => t.id === id);
  if (!timer) return null;

  if (timer.paused) {
    timer.remaining = remainingOf(timer) || timer.remaining || 0;
    timer.endTime = Date.now() + timer.remaining * 1000;
    timer.paused = false;
  } else {
    timer.remaining = remainingOf(timer);
    timer.paused = true;
  }

  await saveTimers(timers);
  await scheduleTimerAlarm(timer);
  await afterTimerChange();
  return timer;
}

async function stopTimer(id) {
  const timers = await getTimers();
  const next = id ? timers.filter((t) => t.id !== id) : [];
  if (id) await chrome.alarms.clear('timer:' + id);
  await saveTimers(next);
  await afterTimerChange();
  return next.length;
}

async function snoozeTimer(id, seconds) {
  const timers = await getTimers();
  const timer = timers.find((t) => t.id === id);
  if (!timer) return null;

  const extra = seconds || 300;
  timer.totalSeconds = (timer.totalSeconds || 0) + extra;
  timer.remaining = (timer.remaining || 0) + extra;
  timer.endTime = Date.now() + timer.remaining * 1000;
  timer.paused = false;

  await saveTimers(timers);
  await scheduleTimerAlarm(timer);
  await afterTimerChange();
  return timer;
}

/* ==================== پومودورو ==================== */
async function startPomodoro() {
  const settings = await getSettings();
  const { focus } = settings.pomodoro;

  const timer = await startTimer({
    title: '🍅 تمرکز',
    totalSeconds: focus * 60,
    kind: 'pomodoro-focus',
    color: '#ef4444'
  });

  await chrome.storage.local.set({
    pomodoroSession: { timerId: timer.id, startedAt: Date.now(), sessionsDone: 0 }
  });

  await updateBadge();
  return timer;
}

async function finishPomodoroSession(timer) {
  const settings = await getSettings();
  const { break: breakMinutes, autoStart } = settings.pomodoro;

  await bumpStat('pomodoros', 1);

  const store = await chrome.storage.local.get(['pomodoroSession']);
  const session = store.pomodoroSession || {};
  session.sessionsDone = (session.sessionsDone || 0) + 1;
  session.lastAt = Date.now();
  await chrome.storage.local.set({ pomodoroSession: session });

  if (autoStart && breakMinutes > 0) {
    await startTimer({
      title: '☕ استراحت',
      totalSeconds: breakMinutes * 60,
      kind: 'pomodoro-break',
      color: '#10b981'
    });
  }
}

/* ==================== حالت تمرکز ==================== */
async function setFocusMode(enabled, durationMinutes) {
  const settings = await getSettings();
  const focus = { ...settings.focus, enabled };

  if (enabled) {
    focus.until = durationMinutes ? Date.now() + durationMinutes * 60000 : 0;
  } else {
    focus.until = 0;
  }

  await saveSettings({ focus });
  await applyFocusRules(focus);
  await afterTimerChange();
  return focus;
}

async function applyFocusRules(focus) {
  if (!chrome.declarativeNetRequest) return;

  // ⚠️ ایمنی: دامنهٔ سرور واسط هرگز نباید مسدود شود
  const proxyHost = (() => {
    try { return new URL(proxyBase()).hostname; } catch (e) { return ''; }
  })();

  const sites = (focus.sites || []).filter((site) => {
    const clean = String(site).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
    if (!clean || clean.length < 3) return false;
    if (proxyHost && (clean === proxyHost || proxyHost.endsWith('.' + clean))) return false;
    return true;
  });

  const ruleIds = sites.map((_, i) => 9000 + i);

  try {
    await chrome.declarativeNetRequest.getSessionRules().then((rules) => {
      const ours = rules.filter((r) => r.id >= 9000 && r.id < 10000).map((r) => r.id);
      return chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ours });
    });
  } catch (e) { /* ادامه */ }

  if (!focus.enabled || !sites.length) return;

  const addRules = sites.map((site, i) => ({
    id: 9000 + i,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: '||' + site.replace(/^https?:\/\//, '').replace(/\/.*$/, '') + '^' }
  }));

  try {
    await chrome.declarativeNetRequest.updateSessionRules({ addRules });
  } catch (e) {
    console.warn('اعمال قوانین مسدودسازی ناموفق بود:', e && e.message);
  }
}

/* ==================== یادآورها ==================== */
async function getReminders() {
  const result = await chrome.storage.local.get(KEYS.reminders);
  return Array.isArray(result[KEYS.reminders]) ? result[KEYS.reminders] : [];
}

async function saveReminders(reminders) {
  await chrome.storage.local.set({ [KEYS.reminders]: reminders });
  const settings = await getSettings();
  if (settings.syncEnabled) await pushToSync();
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function computeNextTrigger(reminder, from) {
  const now = from || Date.now();
  const [h, m] = String(reminder.time || '09:00').split(':').map(Number);
  const base = new Date(now);
  base.setSeconds(0, 0);

  const at = (d) => {
    const x = new Date(d);
    x.setHours(h, m, 0, 0);
    return x;
  };

  if (reminder.repeat === 'once') {
    if (!reminder.date) return null;
    const d = new Date(reminder.date + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    const target = at(d);
    return target.getTime() > now ? target.getTime() : null;
  }

  if (reminder.repeat === 'daily') {
    let target = at(base);
    if (target.getTime() <= now) target = new Date(target.getTime() + 86400000);
    return target.getTime();
  }

  if (reminder.repeat === 'weekly') {
    const days = Array.isArray(reminder.days) && reminder.days.length ? reminder.days : [0];
    for (let i = 0; i <= 7; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      const persianDay = (d.getDay() + 1) % 7;
      if (days.includes(persianDay)) {
        const target = at(d);
        if (target.getTime() > now) return target.getTime();
      }
    }
    return null;
  }

  if (reminder.repeat === 'monthly') {
    for (let i = 0; i <= 12; i++) {
      const candidate = new Date(base.getFullYear(), base.getMonth() + i, 1);
      const day = Math.min(base.getDate(), daysInMonth(candidate.getFullYear(), candidate.getMonth()));
      const target = at(new Date(candidate.getFullYear(), candidate.getMonth(), day));
      if (target.getTime() > now) return target.getTime();
    }
    return null;
  }

  if (reminder.repeat === 'yearly') {
    for (let i = 0; i <= 2; i++) {
      const target = at(new Date(base.getFullYear() + i, base.getMonth(), base.getDate()));
      if (target.getTime() > now) return target.getTime();
    }
    return null;
  }

  return null;
}

async function scheduleReminder(reminder) {
  const name = 'reminder:' + reminder.id;
  await chrome.alarms.clear(name);
  if (reminder.enabled === false) return null;

  const when = computeNextTrigger(reminder);
  if (!when) return null;

  reminder.nextTrigger = when;
  await chrome.alarms.create(name, { when });

  const reminders = await getReminders();
  const index = reminders.findIndex((r) => r.id === reminder.id);
  if (index !== -1) {
    reminders[index] = reminder;
    await saveReminders(reminders);
  }
  return when;
}

async function addReminder(data) {
  const reminders = await getReminders();
  const reminder = {
    id: uid('rem'),
    time: data.time || '09:00',
    text: (data.text || '').trim(),
    repeat: data.repeat || 'daily',
    date: data.date || '',
    days: Array.isArray(data.days) ? data.days : [],
    enabled: true,
    createdAt: Date.now()
  };
  reminders.push(reminder);
  await saveReminders(reminders);
  await scheduleReminder(reminder);
  return reminder;
}

async function deleteReminder(id) {
  const reminders = await getReminders();
  await saveReminders(reminders.filter((r) => r.id !== id));
  await chrome.alarms.clear('reminder:' + id);
}

async function toggleReminder(id) {
  const reminders = await getReminders();
  const reminder = reminders.find((r) => r.id === id);
  if (!reminder) return null;
  reminder.enabled = reminder.enabled === false ? true : false;
  await saveReminders(reminders);
  if (reminder.enabled) await scheduleReminder(reminder);
  else await chrome.alarms.clear('reminder:' + reminder.id);
  return reminder;
}

async function fireReminder(reminder) {
  const settings = await getSettings();

  try {
    await chrome.notifications.create('reminder:' + reminder.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/clock.png'),
      title: '⏰ یادآور Timery',
      message: `${reminder.text}\nساعت ${fa(reminder.time)}`,
      priority: 2,
      requireInteraction: true,
      buttons: [{ title: '⏰ ۵ دقیقه دیگر' }, { title: '✅ انجام شد' }]
    });
  } catch (e) {
    console.warn('خطا در نوتیفیکیشن یادآور:', e && e.message);
  }

  if (settings.soundEnabled) await playAlarmSound();

  const repeatLabel = {
    once: 'یک‌بار', daily: 'روزانه', weekly: 'هفتگی', monthly: 'ماهانه', yearly: 'سالانه'
  }[reminder.repeat];

  const sent = await sendToBale(
    BaleMessages.reminder(
      { time: reminder.time, text: reminder.text, repeatLabel },
      formatNextTriggerLabel(reminder.nextTrigger)
    )
  );

  if (reminder.repeat !== 'once') {
    await scheduleReminder(reminder);
  } else {
    reminder.enabled = false;
    const reminders = await getReminders();
    const index = reminders.findIndex((r) => r.id === reminder.id);
    if (index !== -1) reminders[index] = reminder;
    await saveReminders(reminders);
    await chrome.alarms.clear('reminder:' + reminder.id);
  }

  await bumpStat('firedReminders', 1);
  return sent;
}

/* ==================== بله ==================== */
const BALE_API = 'https://tapi.bale.ai/bot';

/**
 * کلیدی که افزونه می‌فرستد.
 * این «کلید ساختگی» است؛ توکن واقعی ربات فقط روی سرور (Cloudflare) می‌ماند.
 */
function baleKey() {
  return String(CONFIG.baleKey || '').trim();
}

/** آیا ارتباط بله تنظیم شده است؟ */
function baleMode() {
  if (baleKey() && proxyBase()) return 'proxy';
  if (isDirectMode()) return 'direct';
  return 'none';
}

/**
 * روش مستقیم (فقط برای توسعهٔ محلی).
 *
 * 🔒 محافظ امنیتی: حتی اگر کسی اشتباهی توکن واقعی را در js/config.js بگذارد،
 *    تا وقتی `allowDirectToken: true` نباشد این مسیر فعال نمی‌شود.
 *    این‌طوری توکن بات هرگز به‌طور تصادفی داخل بستهٔ افزونه منتشر نمی‌شود.
 */
function isDirectMode() {
  if (CONFIG.allowDirectToken !== true) return false;
  const token = (CONFIG.baleToken || '').trim();
  return token.length > 10 && !/TOKEN_HERE|CHANGE|YOUR/i.test(token);
}

function proxyBase() {
  const url = (CONFIG.proxyUrl || '').trim();
  return url ? url.replace(/\/+$/, '') : '';
}

function normalizeUsername(raw) {
  return String(raw || '').trim().replace(/^@+/, '').toLowerCase();
}

/** تماس با API بله (همیشه با مهلت زمانی) */
async function baleApi(path, options, timeoutMs) {
  const url = `${BALE_API}${(CONFIG.baleToken || '').trim()}/${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(options || {}),
      signal: controller.signal
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, description: text.slice(0, 200) };
    }
    return { status: res.status, data };
  } catch (error) {
    return {
      status: 0,
      data: {
        ok: false,
        description: error && error.name === 'AbortError' ? 'timeout' : String(error && error.message)
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

/** تبدیل یک آپدیت بله به ساختار قابل استفاده */
function parseBaleUpdate(update) {
  if (!update || typeof update !== 'object') return null;
  const message = update.message || update;
  const chat = message.chat || update.chat || {};
  const from = message.from || update.from || {};

  const usernames = [
    chat.username, from.username, update.username
  ].filter(Boolean).map(normalizeUsername);

  return {
    updateId: update.update_id ?? update.id ?? 0,
    chatId: chat.id ?? message.chat_id ?? update.chat_id ?? null,
    username: usernames[0] || '',
    usernames,
    text: message.text || message.caption || update.text || ''
  };
}

/** نگاشت «یوزرنیم → chat_id» در حافظهٔ افزونه */
async function getBaleUsers() {
  const result = await chrome.storage.local.get(['baleUsers', 'baleOffset']);
  return {
    users: result.baleUsers || {},
    offset: result.baleOffset || 0
  };
}

async function rememberBaleUser(username, chatId) {
  if (!username || !chatId) return;
  const { users } = await getBaleUsers();
  if (String(users[username]) === String(chatId)) return;
  users[username] = String(chatId);
  const keys = Object.keys(users);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete users[k];
  await chrome.storage.local.set({ baleUsers: users });
}

/** دریافت پیام‌های جدید ربات (روش مستقیم) */
async function fetchBaleUpdates() {
  const { offset } = await getBaleUsers();
  const { status, data } = await baleApi(`getUpdates?offset=${offset}&timeout=0`, null, 12000);
  if (status !== 200 || !data || !data.ok) {
    return { updates: [], ok: false, error: (data && data.description) || 'api_error' };
  }
  const result = data.result;
  const updates = Array.isArray(result)
    ? result
    : (result && Array.isArray(result.updates)) ? result.updates : [];
  return { updates, ok: true, error: '' };
}

/** پیدا کردن chat_id کاربر از روی یوزرنیم (روش مستقیم) */
async function resolveDirectChatId(username) {
  const { users } = await getBaleUsers();
  if (users[username]) {
    return { chatId: String(users[username]), found: true, seen: Object.keys(users) };
  }

  const { updates, ok } = await fetchBaleUpdates();
  const seen = Object.keys(users);
  let found = null;
  let maxId = 0;

  for (const raw of updates) {
    const parsed = parseBaleUpdate(raw);
    if (!parsed) continue;
    if (parsed.updateId > maxId) maxId = parsed.updateId;

    parsed.usernames.forEach((u) => { if (u && !seen.includes(u)) seen.push(u); });
    if (parsed.chatId) {
      for (const u of parsed.usernames) await rememberBaleUser(u, parsed.chatId);
    }
    if (!found && parsed.chatId && parsed.usernames.includes(username)) {
      found = parsed.chatId;
    }
  }

  if (maxId) await chrome.storage.local.set({ baleOffset: maxId + 1 });
  if (!ok) return { chatId: null, found: false, seen, error: 'api_error' };
  return { chatId: found ? String(found) : null, found: !!found, seen };
}

/* ==================== اتصال بله (Pairing) ==================== */
/**
 * ⚠️ قانون پلتفرم (بله و تلگرام):
 *   ربات نمی‌تواند به یک «چت خصوصی» با @username پیام بدهد.
 *   @username فقط برای کانال‌ها کار می‌کند. برای کاربر عادی باید chat_id عددی
 *   داشته باشیم و آن هم فقط بعد از اینکه کاربر خودش یک‌بار به ربات پیام داده
 *   به دست می‌آید. پس «اتصال» یک مرحلهٔ لازم است، نه یک باگ.
 *
 * جریان:
 *   ۱) افزونه از سرور کد یک‌بارمصرف می‌گیرد
 *   ۲) کاربر لینک  https://ble.ir/<bot>?start=<CODE>  را باز می‌کند
 *   ۳) بله خودش /start <CODE> را می‌فرستد → سرور chat_id را ذخیره می‌کند
 *   ۴) افزونه با /pair/check متوجه می‌شود و chat_id را ذخیره می‌کند
 */

async function getBaleLink() {
  const result = await chrome.storage.local.get(['baleChatId', 'baleLinkedUser', 'balePair']);
  return {
    chatId: result.baleChatId ? String(result.baleChatId) : '',
    username: normalizeUsername(result.baleLinkedUser || ''),
    pair: result.balePair || null
  };
}

async function saveBaleLink(chatId, username) {
  await chrome.storage.local.set({
    baleChatId: chatId ? String(chatId) : '',
    baleLinkedUser: normalizeUsername(username || '')
  });
}

async function clearBaleLink() {
  await chrome.storage.local.remove(['baleChatId', 'baleLinkedUser', 'balePair']);
}

/** ۱) گرفتن کد اتصال تازه از سرور */
async function startBalePairing() {
  const base = proxyBase();
  if (!base || !baleKey()) return { ok: false, error: 'not_configured' };

  const settings = await getSettings();
  const hint = normalizeUsername(settings.username);

  try {
    const { res } = await callWorker('/pair/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: hint })
    }, 20000);

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || 'pair_failed',
        message: data.message || 'ساخت کد اتصال ناموفق بود'
      };
    }

    await chrome.storage.local.set({
      balePair: {
        code: data.code,
        deepLink: data.deepLink || '',
        fallbackCommand: data.fallbackCommand || `/start ${data.code}`,
        botUsername: (data.bot && data.bot.username) || '',
        createdAt: Date.now()
      }
    });

    return {
      ok: true,
      code: data.code,
      deepLink: data.deepLink || '',
      fallbackCommand: data.fallbackCommand || `/start ${data.code}`,
      botUsername: (data.bot && data.bot.username) || '',
      expiresIn: data.expiresIn || 900,
      warning: data.warning || ''
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.name === 'AbortError' ? 'timeout' : 'network_error',
      message: 'ارتباط با سرور برقرار نشد'
    };
  }
}

/** ۲) بررسی اینکه کاربر لینک را باز کرده یا نه */
async function checkBalePairing() {
  const base = proxyBase();
  if (!base || !baleKey()) return { ok: false, error: 'not_configured' };

  const { pair } = await getBaleLink();
  if (!pair || !pair.code) return { ok: true, linked: false, error: 'no_pair' };

  try {
    const { res } = await callWorker('/pair/check?code=' + encodeURIComponent(pair.code), {}, 20000);
    const data = await res.json().catch(() => ({}));

    if (!data.ok) {
      return { ok: false, error: data.error || 'pair_check_failed' };
    }

    if (data.linked && data.chatId) {
      await saveBaleLink(data.chatId, data.username || pair.botUsername || '');

      // یوزرنیم واقعی کاربر را از بله می‌گیریم و در تنظیمات می‌نویسیم
      if (data.username) {
        const settings = await getSettings();
        if (normalizeUsername(settings.username) !== normalizeUsername(data.username)) {
          await saveSettings({ username: '@' + normalizeUsername(data.username) });
        }
      }
      await chrome.storage.local.remove('balePair');

      // 🐞 بدون این خط، آلارم دریافت فرمان‌ها ساخته نمی‌شد و ربات جواب نمی‌داد
      await ensureBalePolling();
    } else if (data.expired) {
      // کد سوخته است — پاکش می‌کنیم تا هر بار سرور را صدا نزنیم
      await chrome.storage.local.remove('balePair');
    }

    return {
      ok: true,
      linked: Boolean(data.linked),
      expired: Boolean(data.expired),
      chatId: data.chatId || '',
      username: data.username || '',
      bot: data.bot || {}
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.name === 'AbortError' ? 'timeout' : 'network_error'
    };
  }
}

/**
 * ارسال پیام به کاربر در بله.
 *  • روش واسط: با chat_id عددی (پایدار) — یا یوزرنیم اگر سرور خودش نگاشت داشته باشد
 *  • روش مستقیم: فقط برای توسعه
 */
async function sendToBale(text) {
  const settings = await getSettings();
  const username = normalizeUsername(settings.username);
  const link = await getBaleLink();

  // ---------- روش مستقیم ----------
  if (isDirectMode()) {
    if (!username && !link.chatId) return { ok: false, error: 'username_missing' };

    let lastError = '';

    // ⭐️ اول chat_id عددی (تنها راه مطمئن برای چت خصوصی)
    const numericId = link.chatId || (username ? (await resolveDirectChatId(username)).chatId : null);

    if (numericId) {
      const numeric = await baleApi('sendMessage', {
        method: 'POST',
        body: JSON.stringify({ chat_id: numericId, text, parse_mode: 'Markdown' })
      }, 12000);

      if (numeric.status === 200 && numeric.data && numeric.data.ok) {
        return { ok: true };
      }
      lastError = (numeric.data && numeric.data.description) || ('HTTP ' + numeric.status);
    }

    // تلاش با @username فقط به‌عنوان آخرین راه (برای کانال‌ها کار می‌کند)
    if (username) {
      for (const chatId of ['@' + username, username]) {
        const direct = await baleApi('sendMessage', {
          method: 'POST',
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
        }, 12000);
        if (direct.status === 200 && direct.data && direct.data.ok) return { ok: true };
        lastError = (direct.data && direct.data.description) || ('HTTP ' + direct.status);
      }
    }

    return {
      ok: false,
      error: 'not_linked',
      description: 'ارسال ناموفق — ابتدا در بله به ربات /start بدهید (' + lastError + ')'
    };
  }

  // ---------- روش واسط ----------
  const base = proxyBase();
  if (!base || !baleKey()) return { ok: false, error: 'not_configured' };

  try {
    const res = await callWorker('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, chatId: link.chatId || undefined, text })
    }, 25000);
    const data = await res.res.json().catch(() => ({}));
    if (!res.res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || 'proxy_error',
        needsPairing: Boolean(data.needsPairing),
        description: data.message || data.description || ''
      };
    }
    return { ok: true };
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    return {
      ok: false,
      error: timedOut ? 'timeout' : 'network_error',
      description: timedOut
        ? 'پاسخی از سرور نرسید (اتمام مهلت زمانی)'
        : String(error && error.message)
    };
  }
}

/** گرفتن هویت ربات (روش مستقیم: از خود API بله / وگرنه از سرور / وگرنه از config) */
async function fetchBotInfo(base, key) {
  const fallback = { username: CONFIG.botUsername || '', firstName: '' };
  if (isDirectMode()) {
    const { data } = await baleApi('getMe', null, 8000);
    if (data && data.ok && data.result && data.result.username) {
      return { username: data.result.username, firstName: data.result.first_name || '' };
    }
    return fallback;
  }
  try {
    const { res } = await callWorker('/bot', {}, 10000);
    const data = await res.json().catch(() => ({}));
    if (data && data.bot && data.bot.username) {
      return { username: data.bot.username, firstName: data.bot.firstName || '' };
    }
  } catch (e) { /* سرور قدیمی یا در دسترس نیست */ }
  return fallback;
}

/** بررسی وضعیت اتصال و شناسایی کاربر + گرفتن هویت ربات */
async function checkBaleStatus() {
  const settings = await getSettings();
  const username = normalizeUsername(settings.username);
  const base = proxyBase();
  const direct = isDirectMode();

  if (!direct && (!base || !baleKey())) {
    return {
      ok: false,
      error: 'not_configured',
      message: 'توکن ربات در js/config.js تنظیم نشده است (بخش baleToken)',
      bot: { username: CONFIG.botUsername || '' }
    };
  }
  const link = await getBaleLink();

  // اگر کد اتصال در انتظار است، اول همان را بررسی می‌کنیم
  if (!direct && link.pair && link.pair.code) {
    const pair = await checkBalePairing();
    if (pair && pair.linked && pair.chatId) {
      link.chatId = String(pair.chatId);
      link.username = normalizeUsername(pair.username);
    }
  }

  if (!username && !link.chatId) {
    return {
      ok: true,
      linked: false,
      needsPairing: true,
      bot: { username: CONFIG.botUsername || '' },
      message: 'هنوز وصل نشده — روی «اتصال به بله» بزنید'
    };
  }

  // ---------- روش مستقیم ----------
  if (direct) {
    const bot = await fetchBotInfo(base, baleKey());
    const probeText = '👋 سلام! من ربات Timery هستم.\nاین پیام یعنی ارتباط افزونه با شما برقرار است ✅\n\nبرای شروع تایمر همین‌جا بنویسید:\n/timer 10m';

    // اول chat_id عددی، بعد @username (که فقط برای کانال‌ها جواب می‌دهد)
    const numericId = link.chatId || (username ? (await resolveDirectChatId(username)).chatId : null);
    let sent = false;

    if (numericId) {
      const numeric = await baleApi('sendMessage', {
        method: 'POST',
        body: JSON.stringify({ chat_id: numericId, text: probeText, parse_mode: 'Markdown' })
      }, 12000);
      sent = numeric.status === 200 && numeric.data && numeric.data.ok;
    }

    if (!sent && username) {
      const probe = await baleApi('sendMessage', {
        method: 'POST',
        body: JSON.stringify({ chat_id: '@' + username, text: probeText, parse_mode: 'Markdown' })
      }, 12000);
      sent = probe.status === 200 && probe.data && probe.data.ok;
    }

    const { users } = await getBaleUsers();

    return {
      ok: true,
      linked: sent,
      needsPairing: !sent,
      chatId: numericId || '',
      bot,
      seen: Object.keys(users),
      message: sent
        ? 'پیام معرفی برای شما ارسال شد ✓'
        : 'ارسال ناموفق بود؛ ابتدا در بله به ربات /start بدهید'
    };
  }

  try {
    // اگر chat_id را از قبل داریم، دیگر لازم نیست سرور را برای شناسایی صدا بزنیم
    if (!username && link.chatId) {
      const bot = await fetchBotInfo(base, baleKey());
      return {
        ok: true,
        linked: true,
        chatId: link.chatId,
        bot,
        seen: [],
        message: 'متصل است ✓'
      };
    }

    // هویت ربات و وضعیت کاربر — موازی (سریع‌تر)
    const [bot, res] = await Promise.all([
      fetchBotInfo(base, baleKey()),
      callWorker('/status?username=' + encodeURIComponent(username), {}, 20000)
    ]);

    const data = await res.res.json().catch(() => ({}));
    if (!res.res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || 'proxy_error',
        message: data.message || 'ارتباط با واسط برقرار نشد',
        bot
      };
    }

    const serverBot = data.bot || {};
    const botUsername = serverBot.username || bot.username || '';

    if (data.linked && data.chatId) {
      await saveBaleLink(data.chatId, username);
    }

    return {
      ok: true,
      linked: !!data.linked,
      needsPairing: !data.linked,
      chatId: data.chatId || '',
      bot: { username: botUsername, firstName: serverBot.firstName || bot.firstName || '' },
      seen: data.seenUsernames || [],
      message: data.linked
        ? 'متصل است ✓'
        : 'این یوزرنیم به ربات وصل نیست — روی «اتصال به بله» بزنید'
    };
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    serverFailures++;
    lastServerError = String(error && error.message);
    return {
      ok: false,
      error: timedOut ? 'timeout' : 'network_error',
      message: timedOut
        ? 'پاسخی از سرور نرسید (اتمام مهلت زمانی)'
        : 'ارتباط با واسط برقرار نشد — سرور در دسترس نیست (' + lastServerError + ')',
      bot: { username: CONFIG.botUsername || '' }
    };
  }
}

/* ==================== فرمان‌های بله → افزونه ==================== */
function parseDurationArg(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;

  const colon = t.match(/^(\d{1,3})\s*:\s*(\d{1,2})$/);
  if (colon) {
    const m = parseInt(colon[1], 10);
    const s = parseInt(colon[2], 10);
    if (s > 59) return null;
    return m * 60 + s;
  }
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);

  let total = 0;
  let matched = false;
  const units = [
    { re: /(\d+(?:\.\d+)?)\s*(?:ساعت(?:ها|های)?|hours?|hr|h)(?![a-z])/g, sec: 3600 },
    { re: /(\d+(?:\.\d+)?)\s*(?:دقیقه(?:ها|های)?|minutes?|min|m)(?![a-z])/g, sec: 60 },
    { re: /(\d+(?:\.\d+)?)\s*(?:ثانیه(?:ها|های)?|seconds?|sec|s)(?![a-z])/g, sec: 1 }
  ];
  units.forEach(({ re, sec }) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(t)) !== null) {
      total += parseFloat(m[1]) * sec;
      matched = true;
    }
  });
  return matched ? Math.round(total) : null;
}

/** تحلیل فرمان کاربر در بله: /timer 10m | /list | /stop | /status | /remind 9:00 متن */
function parseBaleCommand(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('/')) return null;

  const [rawCmd, ...rest] = t.slice(1).split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const arg = rest.join(' ').trim();

  if (cmd === 'timer' || cmd === 't') return { type: 'start_timer', arg };
  if (cmd === 'stop' || cmd === 's') return { type: 'stop_timers', arg: '' };
  if (cmd === 'list' || cmd === 'l') return { type: 'list_timers', arg: '' };
  if (cmd === 'status' || cmd === 'st') return { type: 'status', arg: '' };
  if (cmd === 'remind' || cmd === 'r') return { type: 'add_reminder', arg };
  if (cmd === 'help' || cmd === 'h') return { type: 'help', arg: '' };
  return { type: 'unknown', arg: cmd };
}

async function executeBaleCommand(cmd) {
  const timers = await getTimers();

  switch (cmd.type) {
    case 'start_timer': {
      const seconds = parseDurationArg(cmd.arg);
      if (!seconds) {
        await sendToBale(BaleMessages.error(
          'قالب زمان نامعتبر است.',
          'مثال: /timer 10m یا /timer 25 دقیقه یا /timer 1:30'
        ));
        return;
      }
      await startTimer({ title: 'تایمر (از بله)', totalSeconds: seconds });
      await sendToBale(BaleMessages.timerStarted(seconds));
      break;
    }
    case 'stop_timers': {
      await stopTimer(null);
      await sendToBale(BaleMessages.stopped());
      break;
    }
    case 'list_timers': {
      const list = timers.map((t) => ({ title: t.title, remaining: remainingOf(t) }));
      await sendToBale(BaleMessages.timerList(list));
      break;
    }
    case 'status': {
      const settings = await getSettings();
      const reminders = await getReminders();
      const stats = await getStats();
      await sendToBale(BaleMessages.status({
        timers: timers.length,
        reminders: reminders.length,
        pomodoros: stats.pomodoros || 0,
        focusEnabled: !!settings.focus.enabled,
        focusMinutes: Math.floor((stats.focusSeconds || 0) / 60)
      }));
      break;
    }
    case 'add_reminder': {
      const match = String(cmd.arg || '').match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
      if (!match) {
        await sendToBale(BaleMessages.error(
          'قالب یادآور نامعتبر است.',
          'مثال: /remind 09:00 پرداخت قبض'
        ));
        return;
      }
      const time = `${pad(match[1])}:${match[2]}`;
      await addReminder({ time, text: match[3], repeat: 'daily' });
      await sendToBale(BaleMessages.reminderCreated(time, match[3]));
      break;
    }
    case 'help':
    case 'unknown':
    default:
      await sendToBale(BaleMessages.help());
  }
}

/* ==================== وضعیت دسترسی به سرور ==================== */
let serverFailures = 0;
let lastServerError = '';

const MAX_POLL_FAILURES = 3;

/** آیا سرور در دسترس است؟ (در چند تلاش اخیر) */
function isServerReachable() {
  return serverFailures < MAX_POLL_FAILURES;
}

async function pollBaleCommands() {
  const settings = await getSettings();
  const username = normalizeUsername(settings.username);
  const base = proxyBase();
  const link = await getBaleLink();
  if (!username && !link.chatId) return;

  // ---------- روش مستقیم: خودمان پیام‌های ربات را می‌خوانیم ----------
  if (isDirectMode()) {
    const { updates, ok } = await fetchBaleUpdates();
    if (!ok) return;

    let maxId = 0;
    for (const raw of updates) {
      const parsed = parseBaleUpdate(raw);
      if (!parsed) continue;
      if (parsed.updateId > maxId) maxId = parsed.updateId;

      // ثبت chat_id کاربر برای ارسال‌های بعدی
      if (parsed.chatId) {
        for (const u of parsed.usernames) await rememberBaleUser(u, parsed.chatId);
      }

      // فقط فرمان‌های خودِ کاربر
      if (parsed.text.startsWith('/') && parsed.usernames.includes(username)) {
        const cmd = parseBaleCommand(parsed.text);
        if (cmd) {
          try {
            await executeBaleCommand(cmd);
          } catch (e) {
            console.error('خطا در اجرای فرمان بله:', e);
          }
        }
      }
    }
    if (maxId) await chrome.storage.local.set({ baleOffset: maxId + 1 });
    return;
  }

  // ---------- روش واسط ----------
  if (!base || !baleKey()) return;

  // اگر سرور چند بار پیاپی در دسترس نبود، کمی صبر می‌کنیم تا بی‌جهت تپش نکنیم
  if (!isServerReachable()) {
    const last = await chrome.storage.local.get(['lastServerTry']);
    if (last.lastServerTry && Date.now() - last.lastServerTry < 5 * 60 * 1000) return;
  }

  try {
    const query = '/commands?username=' + encodeURIComponent(username) +
      (link.chatId ? '&chatId=' + encodeURIComponent(link.chatId) : '');
    const { res } = await callWorker(query, {}, 12000);
    const data = await res.res.json().catch(() => ({}));
    serverFailures = 0;
    lastServerError = '';
    await chrome.storage.local.set({ lastServerTry: Date.now() });

    // سرور ممکن است chat_id را بهتر از ما بداند
    if (data.chatId && !link.chatId) {
      await saveBaleLink(data.chatId, data.username || username);
    }

    if (!data.ok || !Array.isArray(data.commands)) return;

    for (const cmd of data.commands) {
      try {
        await executeBaleCommand(cmd);
      } catch (e) {
        console.error('خطا در اجرای فرمان بله:', e);
      }
    }
  } catch (error) {
    serverFailures++;
    lastServerError = String(error && error.message);
    await chrome.storage.local.set({ lastServerTry: Date.now() });
    console.warn('دریافت فرمان‌های بله ناموفق بود (' + serverFailures + '):', lastServerError);
  }
}

/* ==================== صدا (offscreen) ==================== */
let creatingOffscreen = false;

async function ensureOffscreen() {
  if (!chrome.offscreen) return false;
  try {
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) return true;
  } catch (e) { /* ادامه */ }
  if (creatingOffscreen) return false;
  creatingOffscreen = true;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'پخش صدای پایان تایمر و یادآور'
    });
    return true;
  } catch (e) {
    console.warn('ساخت offscreen document ناموفق بود:', e && e.message);
    return false;
  } finally {
    creatingOffscreen = false;
  }
}

async function playAlarmSound() {
  const src = chrome.runtime.getURL('alarm.mp3');
  const ok = await ensureOffscreen();
  if (ok) {
    try {
      await chrome.runtime.sendMessage({ type: 'PLAY_SOUND', src });
      return;
    } catch (e) { /* fallback */ }
  }
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (isTabEligible(tab)) {
      chrome.tabs.sendMessage(tab.id, { action: 'play_sound', src }).catch(() => { });
    }
  }
}

/* ==================== Badge ==================== */
async function updateBadge() {
  const settings = await getSettings();
  const timers = await getTimers();
  const active = timers.filter((t) => !t.paused && t.endTime > Date.now());
  active.sort((a, b) => a.endTime - b.endTime);

  if (!settings.badgeEnabled || active.length === 0) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const remaining = Math.max(0, Math.floor((active[0].endTime - Date.now()) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const text = minutes >= 60 ? `${Math.floor(minutes / 60)}h` : minutes > 0 ? `${minutes}m` : `${seconds}`;

  await chrome.action.setBadgeText({ text: fa(text) });
  await chrome.action.setBadgeBackgroundColor({ color: active[0].color || '#6366f1' });
}

/* ==================== همگام‌سازی با تب‌ها ==================== */
function isTabEligible(tab) {
  if (!tab || !tab.url) return false;
  const allowed = ['http:', 'https:', 'file:'];
  const blocked = ['chrome://', 'edge://', 'about:', 'brave://', 'vivaldi://', 'chrome-extension://'];
  try {
    const url = new URL(tab.url);
    if (!allowed.includes(url.protocol)) return false;
    if (blocked.some((prefix) => tab.url.startsWith(prefix))) return false;
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (res && res.ok) return true;
  } catch (e) { /* هنوز تزریق نشده */ }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content_overlay.js'] });
    return true;
  } catch (e) {
    return false;
  }
}

async function buildStatePayload(extra) {
  const settings = await getSettings();
  const timers = await getTimers();
  return {
    action: 'sync_state',
    timers: settings.showOverlay ? timers.map(serializeTimer) : [],
    settings: {
      titleCountdown: settings.titleCountdown,
      soundEnabled: settings.soundEnabled,
      focusEnabled: settings.focus.enabled
    },
    ...(extra || {})
  };
}

async function broadcastState(extra) {
  const payload = await buildStatePayload(extra);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!isTabEligible(tab)) continue;
    chrome.tabs.sendMessage(tab.id, payload).catch(() => { });
    if (extra && extra.endedTimerId) {
      chrome.tabs.sendMessage(tab.id, { action: 'timer_ended', timerId: extra.endedTimerId }).catch(() => { });
    }
  }
}

async function afterTimerChange(extra) {
  await updateBadge();
  await broadcastState(extra);
}

/* ==================== آمار ==================== */
async function getStats() {
  const result = await chrome.storage.local.get(KEYS.stats);
  return { finishedTimers: 0, focusSeconds: 0, firedReminders: 0, pomodoros: 0, ...(result[KEYS.stats] || {}) };
}

async function bumpStat(key, amount) {
  const stats = await getStats();
  stats[key] = (stats[key] || 0) + (amount || 0);
  await chrome.storage.local.set({ [KEYS.stats]: stats });
  return stats;
}

/* ==================== سینک بین دستگاه‌ها ==================== */
let syncGuard = false;

async function pushToSync() {
  if (syncGuard) return;
  try {
    syncGuard = true;
    const local = await chrome.storage.local.get([KEYS.timers, KEYS.reminders, KEYS.settings]);
    await chrome.storage.sync.set({
      timers: local[KEYS.timers] || [],
      reminders: local[KEYS.reminders] || [],
      settings: local[KEYS.settings] || {}
    });
  } catch (e) {
    console.warn('ارسال به sync ناموفق بود:', e && e.message);
  } finally {
    syncGuard = false;
  }
}

async function pullFromSync() {
  try {
    syncGuard = true;
    const sync = await chrome.storage.sync.get(['timers', 'reminders', 'settings']);
    if (!sync.timers && !sync.reminders && !sync.settings) return;
    await chrome.storage.local.set({
      [KEYS.timers]: sync.timers || [],
      [KEYS.reminders]: sync.reminders || [],
      [KEYS.settings]: { ...(await getSettings()), ...(sync.settings || {}) }
    });
    await restoreAlarms();
    await afterTimerChange();
  } catch (e) {
    console.warn('خواندن از sync ناموفق بود:', e && e.message);
  } finally {
    syncGuard = false;
  }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || syncGuard) return;
  const settings = await getSettings();
  if (settings.syncEnabled) await pullFromSync();
});

/* ==================== نگهبان یادآورها ==================== */
/**
 * 🐞 چرا لازم است؟ آلارم‌های Chrome همیشه قابل اعتماد نیستند:
 *   • وقتی مرورگر بسته بوده و دوباره باز می‌شود
 *   • وقتی سرویس‌ورکر خوابیده و Chrome آلارم را دیر بیدار می‌کند
 *   • وقتی افزونه Reload می‌شود (آلارم‌ها پاک می‌شوند ولی یادآور می‌ماند)
 *
 * این تابع هر ۳۰ ثانیه اجرا می‌شود و هر یادآوری که موعدش گذشته را
 * دستی اجرا می‌کند. یعنی حتی اگر آلارم از دست برود، یادآور گم نمی‌شود.
 */
async function checkDueReminders() {
  const now = Date.now();
  const reminders = await getReminders();
  let fired = 0;

  for (const reminder of reminders) {
    if (reminder.enabled === false) continue;
    if (!reminder.nextTrigger) continue;
    if (reminder.nextTrigger > now) continue;

    // اول علامت می‌زنیم تا در تیک بعدی دوباره اجرا نشود
    reminder.nextTrigger = null;
    await saveReminders(reminders);

    try {
      await fireReminder(reminder);
      fired++;
    } catch (e) {
      console.error('خطا در اجرای یادآور:', e);
    }
  }
  return fired;
}

/* ==================== Alarm ها ==================== */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === 'badge-tick') {
      await updateBadge();
      await checkDueReminders();
      return;
    }

    if (alarm.name === 'bale-poll') {
      await pollBaleCommands();
      return;
    }

    if (alarm.name === 'focus-check') {
      const settings = await getSettings();
      if (settings.focus.enabled && settings.focus.until && Date.now() > settings.focus.until) {
        await setFocusMode(false);
        await sendToBale(BaleMessages.focusEnded());
      }
      return;
    }

    if (alarm.name.startsWith('timer:')) {
      const id = alarm.name.slice(6);
      const timers = await getTimers();
      const timer = timers.find((t) => t.id === id);
      if (!timer) return;
      if (timer.paused) {
        await scheduleTimerAlarm(timer);
        return;
      }
      await finishTimer(timer);
      return;
    }

    if (alarm.name.startsWith('reminder:')) {
      const id = alarm.name.slice(9);
      const reminders = await getReminders();
      const reminder = reminders.find((r) => r.id === id);
      if (!reminder) {
        await chrome.alarms.clear(alarm.name);
        return;
      }
      await fireReminder(reminder);
    }
  } catch (error) {
    console.error('خطا در پردازش آلارم:', error);
  }
});

async function finishTimer(timer) {
  const settings = await getSettings();

  const timers = await getTimers();
  await saveTimers(timers.filter((t) => t.id !== timer.id));
  await chrome.alarms.clear('timer:' + timer.id);

  await bumpStat('finishedTimers', 1);
  await bumpStat('focusSeconds', timer.totalSeconds || 0);

  if (settings.notifyOnTimerEnd) {
    try {
      await chrome.notifications.create('timer:' + timer.id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/clock.png'),
        title: timer.kind === 'pomodoro-focus' ? '🍅 جلسهٔ تمرکز تمام شد' : '⏰ تایمر تمام شد',
        message: `${timer.title} — ${formatClock(timer.totalSeconds)}`,
        priority: 2,
        requireInteraction: true,
        buttons: [{ title: '۵ دقیقه بیشتر' }, { title: 'انجام شد' }]
      });
    } catch (e) {
      console.warn('خطا در ساخت نوتیفیکیشن تایمر:', e && e.message);
    }
  }

  if (settings.soundEnabled) await playAlarmSound();

  if (timer.kind === 'pomodoro-focus') await finishPomodoroSession(timer);

  await afterTimerChange({ endedTimerId: timer.id });
}

/* ==================== اعلان‌ها ==================== */
chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  chrome.notifications.clear(notificationId);

  if (notificationId.startsWith('timer:')) {
    const id = notificationId.slice(6);
    if (buttonIndex === 0) await snoozeTimer(id, 300);
    else await stopTimer(id);
    return;
  }

  if (notificationId.startsWith('reminder:')) {
    const id = notificationId.slice(9);
    if (buttonIndex === 0) {
      await chrome.alarms.create('reminder:' + id, { when: Date.now() + 300000 });
    } else {
      await deleteReminder(id);
    }
  }
});

/* ==================== تب‌ها ==================== */
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id) return;
  await new Promise((r) => setTimeout(r, 800));
  if (!isTabEligible(tab)) return;
  if (await ensureContentScript(tab.id)) {
    chrome.tabs.sendMessage(tab.id, await buildStatePayload()).catch(() => { });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!isTabEligible(tab)) return;
  if (await ensureContentScript(tabId)) {
    chrome.tabs.sendMessage(tabId, await buildStatePayload()).catch(() => { });
  }
});

/* ==================== پیام‌های داخلی ==================== */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'get_state': {
          sendResponse({
            success: true,
            timers: (await getTimers()).map(serializeTimer),
            reminders: await getReminders(),
            settings: await getSettings(),
            stats: await getStats()
          });
          break;
        }
        case 'start_timer': {
          const timer = await startTimer(request.timerData || {});
          sendResponse({ success: true, timer: serializeTimer(timer) });
          break;
        }
        case 'start_pomodoro': {
          const timer = await startPomodoro();
          sendResponse({ success: true, timer: serializeTimer(timer) });
          break;
        }
        case 'toggle_timer': {
          const timer = await toggleTimer(request.timerId);
          sendResponse({ success: !!timer, timer: timer ? serializeTimer(timer) : null });
          break;
        }
        case 'stop_timer': {
          await stopTimer(request.timerId);
          sendResponse({ success: true });
          break;
        }
        case 'add_reminder': {
          const reminder = await addReminder(request.reminderData || {});
          sendResponse({ success: true, reminder });
          break;
        }
        case 'delete_reminder': {
          await deleteReminder(request.reminderId);
          sendResponse({ success: true });
          break;
        }
        case 'toggle_reminder': {
          const reminder = await toggleReminder(request.reminderId);
          sendResponse({ success: !!reminder, reminder });
          break;
        }
        case 'save_settings': {
          const settings = await saveSettings(request.patch || {});
          if (request.patch && 'focus' in request.patch) {
            await applyFocusRules(settings.focus);
          }
          if (request.patch && 'username' in request.patch) {
            await ensureBalePolling();
          }
          await afterTimerChange();
          sendResponse({ success: true, settings });
          break;
        }
        case 'set_focus_mode': {
          const focus = await setFocusMode(request.enabled, request.durationMinutes);
          sendResponse({ success: true, focus });
          break;
        }
        case 'test_server': {
          // تست خام: /health یک GET ساده است (بدون preflight و بدون کلید)
          const base = proxyBase();
          if (!base) {
            sendResponse({ success: false, error: 'not_configured' });
            break;
          }
          const started = Date.now();
          try {
            const res = await fetchWithTimeout(base + '/health', {}, 10000);
            const text = await res.text();
            serverFailures = 0;
            sendResponse({
              success: res.ok,
              status: res.status,
              time: Date.now() - started,
              body: text.slice(0, 400),
              url: base + '/health'
            });
          } catch (error) {
            serverFailures++;
            sendResponse({
              success: false,
              error: error && error.name === 'AbortError' ? 'timeout' : 'network_error',
              message: String(error && error.message),
              time: Date.now() - started,
              url: base + '/health'
            });
          }
          break;
        }
        case 'test_bale_raw': {
          // تست خام: پاسخ دقیق API بله برای ارسال به یوزرنیم
          const settings = await getSettings();
          const user = normalizeUsername(settings.username);
          if (!user) {
            sendResponse({ success: false, error: 'username_missing' });
            break;
          }
          if (!isDirectMode()) {
            sendResponse({ success: false, error: 'not_configured' });
            break;
          }

          const results = [];
          // الف) با @
          const a = await baleApi('sendMessage', {
            method: 'POST',
            body: JSON.stringify({ chat_id: '@' + user, text: '🧪 تست Timery' })
          }, 12000);
          results.push({
            variant: '@' + user,
            status: a.status,
            ok: !!(a.data && a.data.ok),
            body: JSON.stringify(a.data).slice(0, 300)
          });

          // ب) بدون @
          if (!(a.status === 200 && a.data && a.data.ok)) {
            const b = await baleApi('sendMessage', {
              method: 'POST',
              body: JSON.stringify({ chat_id: user, text: '🧪 تست Timery' })
            }, 12000);
            results.push({
              variant: user,
              status: b.status,
              ok: !!(b.data && b.data.ok),
              body: JSON.stringify(b.data).slice(0, 300)
            });
          }

          // ج) با chat_id عددی (از پیام‌های ربات)
          const resolved = await resolveDirectChatId(user);
          if (!results.some((r) => r.ok) && resolved.found) {
            const c = await baleApi('sendMessage', {
              method: 'POST',
              body: JSON.stringify({ chat_id: resolved.chatId, text: '🧪 تست Timery' })
            }, 12000);
            results.push({
              variant: 'chat_id:' + resolved.chatId,
              status: c.status,
              ok: !!(c.data && c.data.ok),
              body: JSON.stringify(c.data).slice(0, 300)
            });
          }

          // د) تست خود توکن
          const me = await baleApi('getMe', null, 10000);
          results.push({
            variant: 'getMe (تست توکن)',
            status: me.status,
            ok: !!(me.data && me.data.ok),
            body: JSON.stringify(me.data).slice(0, 200)
          });

          sendResponse({
            success: results.some((r) => r.ok),
            username: user,
            resolvedChatId: resolved.chatId || null,
            results
          });
          break;
        }
        case 'pair_start': {
          const result = await startBalePairing();
          sendResponse(result);
          break;
        }
        case 'pair_check': {
          const result = await checkBalePairing();
          sendResponse(result);
          break;
        }
        case 'unlink_bale': {
          await clearBaleLink();
          await saveSettings({ username: '' });
          sendResponse({ success: true });
          break;
        }
        case 'test_reminder': {
          // یادآور آزمایشی: هم نوتیفیکیشن سیستم، هم پیام بله
          const now = new Date();
          const hhmm = pad(now.getHours()) + ':' + pad(now.getMinutes());
          const demo = {
            id: 'test',
            time: hhmm,
            text: 'این یک یادآور آزمایشی است',
            repeat: 'once',
            nextTrigger: Date.now()
          };
          const sent = await fireReminder(demo);
          sendResponse({
            success: true,
            baleSent: Boolean(sent && sent.ok),
            baleError: (sent && (sent.description || sent.error)) || ''
          });
          break;
        }
        case 'check_due_reminders': {
          const count = await checkDueReminders();
          sendResponse({ success: true, fired: count });
          break;
        }
        case 'check_bale': {
          const status = await checkBaleStatus();
          // هویت ربات را ذخیره می‌کنیم تا در رابط کاربری نمایش داده شود
          if (status.bot && status.bot.username) {
            const settings = await getSettings();
            if (settings.botUsername !== status.bot.username) {
              await saveSettings({ botUsername: status.bot.username });
            }
          }
          // فرمان‌های معطل‌مانده را همین حالا هم پردازش می‌کنیم (بدون بلوکه‌کردن UI)
          if (status.ok && status.linked) pollBaleCommands().catch(() => {});
          sendResponse(status);
          break;
        }
        case 'ping_bale': {
          // ربات خودش معرفی می‌کند تا کاربر مطمئن شود به چه رباتی باید پیام بدهد
          const settings = await getSettings();
          const botUsername = settings.botUsername || CONFIG.botUsername || '';
          const result = await sendToBale(BaleMessages.ping(botUsername));
          sendResponse({
            success: result.ok,
            error: result.error,
            message: result.description,
            description: result.description,
            botUsername
          });
          break;
        }
        case 'send_test_bale': {
          const result = await sendToBale(BaleMessages.test());
          sendResponse({
            success: result.ok,
            error: result.error,
            description: result.description,
            message: result.description
          });
          break;
        }
        case 'test_notification': {
          await chrome.notifications.create('test_' + Date.now(), {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/clock.png'),
            title: '✅ تست نوتیفیکیشن',
            message: 'نوتیفیکیشن‌ها به‌درستی کار می‌کنند!',
            priority: 1
          });
          if ((await getSettings()).soundEnabled) await playAlarmSound();
          sendResponse({ success: true });
          break;
        }
        case 'export_data': {
          sendResponse({
            success: true,
            data: {
              version: 4,
              exportedAt: new Date().toISOString(),
              timers: await getTimers(),
              reminders: await getReminders(),
              settings: await getSettings(),
              stats: await getStats()
            }
          });
          break;
        }
        case 'import_data': {
          const data = request.data || {};
          if (Array.isArray(data.timers)) await saveTimers(data.timers);
          if (Array.isArray(data.reminders)) await saveReminders(data.reminders);
          if (data.settings) await saveSettings(data.settings);
          await restoreAlarms();
          await afterTimerChange();
          sendResponse({ success: true });
          break;
        }
        case 'reset_data': {
          await chrome.storage.local.remove([KEYS.timers, KEYS.reminders, KEYS.stopwatch, KEYS.stats]);
          await restoreAlarms();
          await afterTimerChange();
          sendResponse({ success: true });
          break;
        }
        default:
          sendResponse({ success: false, error: 'unknown_action' });
      }
    } catch (error) {
      console.error('خطا در پردازش پیام:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true;
});

/* ==================== شورتکات‌ها ==================== */
chrome.commands?.onCommand.addListener(async (command) => {
  const minutes = command === 'quick-timer-25' ? 25 : 5;
  const timer = await startTimer({
    title: `تایمر سریع ${minutes} دقیقه`,
    totalSeconds: minutes * 60
  });
  chrome.notifications.create('quick_' + timer.id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/clock.png'),
    title: '⏰ تایمر شروع شد',
    message: `${minutes} دقیقه`
  });
});

/**
 * مطمئن می‌شود آلارم دریافت فرمان‌های بله وجود دارد.
 *
 * 🐞 باگ قبلی: شرط فقط `settings.username` بود. در جریان جدید «اتصال با کد»،
 *    کاربر ممکن است هیچ یوزرنیمی تایپ نکرده باشد و فقط chatId داشته باشد؛
 *    در آن حالت آلارم ساخته نمی‌شد و فرمان‌های بله برای همیشه در صف می‌ماندند
 *    (ربات هیچ جوابی نمی‌داد).
 */
async function ensureBalePolling() {
  await chrome.alarms.clear('bale-poll');
  if (!proxyBase() && !isDirectMode()) return;

  const settings = await getSettings();
  const link = await getBaleLink();
  if (!settings.username && !link.chatId) return;

  const every = Math.max(1, CONFIG.pollIntervalMinutes || 1);
  await chrome.alarms.create('bale-poll', { periodInMinutes: every, delayInMinutes: 0.1 });
}

/* ==================== راه‌اندازی ==================== */
async function restoreAlarms() {
  const timers = await getTimers();
  for (const timer of timers) {
    if (!timer.paused && timer.endTime > Date.now()) {
      await scheduleTimerAlarm(timer);
    } else if (timer.paused) {
      await chrome.alarms.clear('timer:' + timer.id);
    } else {
      await saveTimers(timers.filter((t) => t.id !== timer.id));
    }
  }

  const reminders = await getReminders();
  for (const reminder of reminders) {
    if (reminder.enabled !== false) await scheduleReminder(reminder);
    else await chrome.alarms.clear('reminder:' + reminder.id);
  }

  await chrome.alarms.clear('badge-tick');
  await chrome.alarms.create('badge-tick', { periodInMinutes: 0.5 });

  await ensureBalePolling();

  await chrome.alarms.clear('focus-check');
  await chrome.alarms.create('focus-check', { periodInMinutes: 1 });

  await updateBadge();
}

chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(KEYS.settings);
  if (!result[KEYS.settings]) {
    await chrome.storage.local.set({ [KEYS.settings]: DEFAULT_SETTINGS });
  }
  await restoreAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  await restoreAlarms();
});

(async () => {
  await restoreAlarms();
  console.log('✅ Timery service worker آماده است');
})();
