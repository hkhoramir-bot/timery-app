/**
 * offscreen.js — پخش صدای هشدار از طریق سند آف‌اسکرین
 * (سرویس‌ورکر به‌تنهایی نمی‌تواند صدا پخش کند).
 */
(function () {
  'use strict';

  let audio = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'PLAY_SOUND') {
      play(message.src);
      sendResponse({ success: true });
    }
    return true;
  });

  function play(src) {
    try {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      audio = new Audio(src);
      audio.volume = 1;
      const done = () => { audio = null; };
      audio.addEventListener('ended', done);
      audio.addEventListener('error', done);
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // اگر مرورگر پخش را بلاک کرد، دوباره تلاش می‌کنیم
          setTimeout(() => {
            try { audio.play(); } catch (e) { /* بی‌خیال */ }
          }, 120);
        });
      }
    } catch (error) {
      console.warn('پخش صدا ناموفق بود:', error && error.message);
    }
  }
})();
