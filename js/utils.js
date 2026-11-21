/**
 * js/utils.js
 * ------------------------------------------------------------------
 * ابزارهای مشترک بین popup و صفحه‌های دیگر: قالب‌بندی زمان، toast،
 * مودال تأیید و کمکی‌های تاریخ.
 */
(function (global) {
  'use strict';

  /** ۰۰:۰۵:۳۰ */
  function formatDuration(ms, opts) {
    var o = opts || {};
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var core = h > 0 ? pad(h) + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
    return o.persian ? Jalali.toPersianDigits(core) : core;
  }

  /** ۰۰:۰۵ (برای badge) */
  function formatBadge(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    if (m >= 60) {
      var h = Math.floor(m / 60);
      return h + 'h';
    }
    if (m > 0) return m + 'm';
    return s + 's';
  }

  /** خوانش فارسی اعداد */
  function fa(value) {
    return Jalali.toPersianDigits(value);
  }

  /** متن نسبی "۳ دقیقه پیش" */
  function timeAgo(timestamp) {
    var diff = Date.now() - timestamp;
    var min = Math.floor(diff / 60000);
    if (min < 1) return 'همین الان';
    if (min < 60) return fa(min) + ' دقیقه پیش';
    var h = Math.floor(min / 60);
    if (h < 24) return fa(h) + ' ساعت پیش';
    var d = Math.floor(h / 24);
    return fa(d) + ' روز پیش';
  }

  // ---------------- Toast ----------------
  var toastHost = null;

  function getToastHost() {
    if (!toastHost) {
      toastHost = document.getElementById('toast-host');
    }
    return toastHost;
  }

  function toast(message, type, duration) {
    var host = getToastHost();
    if (!host) return;
    var kind = type || 'info';
    var el = document.createElement('div');
    el.className = 'toast toast-' + kind;

    var icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = kind === 'success' ? '✓' : kind === 'error' ? '✕' : kind === 'warning' ? '!' : 'i';

    var text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message; // امن: بدون innerHTML

    el.appendChild(icon);
    el.appendChild(text);
    host.appendChild(el);

    requestAnimationFrame(function () { el.classList.add('show'); });

    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 250);
    }, duration || 3000);
  }

  // ---------------- Confirm ----------------
  /**
   * مودال تأیید به‌جای confirm() مرورگر.
   * @returns {Promise<boolean>}
   */
  function confirmDialog(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var modal = document.getElementById('confirm-modal');
      if (!modal) { resolve(window.confirm(opts.message || 'آیا مطمئن هستید؟')); return; }

      var titleEl = modal.querySelector('#confirm-title');
      var msgEl = modal.querySelector('#confirm-message');
      var okBtn = modal.querySelector('#confirm-ok');
      var cancelBtn = modal.querySelector('#confirm-cancel');

      if (titleEl) titleEl.textContent = opts.title || 'تأیید عملیات';
      if (msgEl) msgEl.textContent = opts.message || 'آیا مطمئن هستید؟';
      if (okBtn) {
        okBtn.textContent = opts.okText || 'بله';
        okBtn.className = 'btn ' + (opts.danger === false ? 'btn-primary' : 'btn-danger');
      }
      if (cancelBtn) cancelBtn.textContent = opts.cancelText || 'انصراف';

      modal.classList.add('open');

      function cleanup(result) {
        modal.classList.remove('open');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onBackdrop(e) { if (e.target === modal) cleanup(false); }
      function onKey(e) { if (e.key === 'Escape') cleanup(false); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
    });
  }

  // ---------------- متفرقه ----------------
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** ساخت عنصر با متن امن */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  global.Utils = {
    formatDuration: formatDuration,
    formatBadge: formatBadge,
    fa: fa,
    timeAgo: timeAgo,
    toast: toast,
    confirmDialog: confirmDialog,
    debounce: debounce,
    uid: uid,
    el: el
  };
})(typeof window !== 'undefined' ? window : self);
