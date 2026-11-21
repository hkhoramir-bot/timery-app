/**
 * mock-chrome.js — فقط برای پیش‌نمایش UI در مرورگر (بدون نصب افزونه)
 */
(function () {
  'use strict';

  const store = {
    timers: [
      { id: 't1', title: 'چای', totalSeconds: 300, endTime: Date.now() + 214000, remaining: 214, paused: false, color: '#10b981', createdAt: Date.now() },
      { id: 't2', title: 'پومودورو', totalSeconds: 1500, endTime: Date.now() + 940000, remaining: 940, paused: true, color: '#6366f1', createdAt: Date.now() }
    ],
    reminders: [
      { id: 'r1', time: '09:00', text: 'پرداخت قبض برق', repeat: 'daily', days: [], enabled: true, createdAt: Date.now() },
      { id: 'r2', time: '18:30', text: 'جلسهٔ هفتگی تیم', repeat: 'weekly', days: [0, 2], enabled: true, createdAt: Date.now() },
      { id: 'r3', time: '13:15', text: 'خواب ظهر', repeat: 'daily', days: [], enabled: false, createdAt: Date.now() }
    ],
    stopwatch: { running: false, elapsed: 0, startTime: 0 },
    settings: {
      theme: new URLSearchParams(location.search).get('theme') || 'auto',
      username: '@hkhoramir',
      soundEnabled: true,
      notifyOnTimerEnd: true,
      showOverlay: true,
      titleCountdown: true,
      badgeEnabled: true,
      syncEnabled: false,
      pomodoro: { focus: 25, break: 5, sessions: 4, autoStart: true },
      focus: {
        enabled: false,
        autoStart: true,
        sites: ['instagram.com', 'youtube.com', 'telegram.org', 'x.com'],
        until: 0
      }
    },
    stats: { finishedTimers: 128, focusSeconds: 24600, firedReminders: 42, pomodoros: 3 }
  };

  const listeners = { changed: [], message: [] };

  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '3.1.0' }),
      sendMessage: (msg) => {
        if (msg.action === 'export_data') {
          return Promise.resolve({ success: true, data: store });
        }
        if (msg.action === 'check_bale') {
          return Promise.resolve({
            ok: true,
            linked: true,
            message: 'یوزرنیم متصل است ✓',
            bot: { username: '@TimeryBot', firstName: 'Timery' }
          });
        }
        if (msg.action === 'ping_bale') {
          return Promise.resolve({ success: true, botUsername: '@TimeryBot' });
        }
        if (msg.action === 'send_test_bale') {
          return Promise.resolve({ success: true });
        }
        if (msg.action === 'set_focus_mode') {
          store.settings.focus = { ...store.settings.focus, enabled: !!msg.enabled };
          notifyChanged();
          return Promise.resolve({ success: true, focus: store.settings.focus });
        }
        if (msg.action === 'start_pomodoro') {
          return Promise.resolve({ success: true });
        }
        if (msg.action === 'save_settings') {
          Object.assign(store.settings, msg.patch || {});
          notifyChanged();
          return Promise.resolve({ success: true, settings: store.settings });
        }
        if (msg.action === 'send_test_bale') {
          return Promise.resolve({ success: true });
        }
        if (msg.action === 'check_proxy') {
          return Promise.resolve({ success: true, data: { ok: true, tokenConfigured: true } });
        }
        return Promise.resolve({ success: true });
      },
      onMessage: { addListener: (fn) => listeners.message.push(fn) }
    },
    storage: {
      local: {
        get: (keys) => Promise.resolve(
          Array.isArray(keys)
            ? keys.reduce((acc, k) => (acc[k] = store[k], acc), {})
            : typeof keys === 'string' ? { [keys]: store[keys] } : { ...store }
        ),
        set: (obj) => {
          Object.assign(store, obj);
          notifyChanged();
          return Promise.resolve();
        },
        remove: (keys) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
          notifyChanged();
          return Promise.resolve();
        }
      },
      onChanged: { addListener: (fn) => listeners.changed.push(fn) }
    },
    action: {
      setBadgeText: () => Promise.resolve(),
      setBadgeBackgroundColor: () => Promise.resolve()
    },
    tabs: { create: () => {} }
  };

  function notifyChanged() {
    listeners.changed.forEach((fn) => fn(
      { timers: { newValue: store.timers }, reminders: { newValue: store.reminders }, settings: { newValue: store.settings }, stats: { newValue: store.stats } },
      'local'
    ));
  }
})();
