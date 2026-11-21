/**
 * ساخت صفحهٔ پیش‌نمایش UI (بدون نصب افزونه در مرورگر)
 * اجرا: node tests/make-preview.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');

html = html.replace('href="style.css"', 'href="../style.css"');
// در پیش‌نمایش، بدنه وسط‌چین می‌شود تا در اسکرین‌شات کامل دیده شود
html = html.replace('</head>', '<style>body{margin:0 auto;box-shadow:0 0 0 1px #cbd5e1}*{animation:none!important;transition:none!important}</style>\n</head>');
html = html.replace('src="js/jalali.js"', 'src="../js/jalali.js"');
html = html.replace('src="js/utils.js"', 'src="../js/utils.js"');
html = html.replace('src="js/config.js"', 'src="../js/config.js"');
html = html.replace(
  '<script src="popup.js"></script>',
  '<script src="mock-chrome.js"></script>\n    <script src="../popup.js"></script>'
);

// امکان انتخاب تب از طریق hash: preview.html#settings
html = html.replace(
  '</body>',
  `<script>
  window.addEventListener('load', function () {
    var tab = (location.hash || '').replace('#', '');
    if (tab) {
      var btn = document.querySelector('.tab-btn[data-tab="' + tab + '"]');
      if (btn) setTimeout(function () { btn.click(); }, 120);
    }

    // پوستهٔ تیره برای بررسی ظاهری: ?theme=dark
    var theme = new URLSearchParams(location.search).get('theme');
    if (theme) document.documentElement.setAttribute('data-theme', theme);

    // نمایش مودال نتیجه: ?demo=age
    if (new URLSearchParams(location.search).get('demo') === 'age') {
      setTimeout(function () {
        var input = document.getElementById('birth-jalali');
        if (input) {
          input.value = '1370/01/15';
          document.getElementById('calculate-age').click();
        }
      }, 500);
    }
    // گزارش سرریز افقی (فقط با ?debug=1 — خودش باعث سرریز می‌شود)
    if (location.search.indexOf('debug=1') === -1) return;
    setTimeout(function () {
      var limit = 380, report = [];
      document.querySelectorAll('*').forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.width > limit + 1 || r.right > limit + 1 || r.left < -1) {
          report.push({
            tag: el.tagName, id: el.id,
            cls: (el.className || '').toString().slice(0, 28),
            w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right)
          });
        }
      });
      var pre = document.createElement('pre');
      pre.id = 'overflow-report';
      pre.textContent = 'OVERFLOW=' + JSON.stringify({
        docScrollW: document.documentElement.scrollWidth,
        bodyScrollW: document.body.scrollWidth,
        bodyW: Math.round(document.body.getBoundingClientRect().width),
        items: report.slice(0, 18)
      });
      document.body.appendChild(pre);
    }, 700);
  });
  </script>
</body>`
);

fs.writeFileSync(path.join(root, 'tests', 'preview.html'), html);
console.log('✅ tests/preview.html ساخته شد');
