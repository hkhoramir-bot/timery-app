/**
 * تست منطق «روش مستقیم» بله (بدون سرور) — اجرا: node tests/direct-test.js
 * توابع کلیدی سرویس‌ورکر را شبیه‌سازی می‌کند.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label); }
}

/* ---------- شبیه‌سازی ---------- */
const BALE = {
  updates: [
    {
      update_id: 5,
      message: {
        message_id: 1,
        from: { id: 111, is_bot: false, first_name: 'hosseink', username: 'hosseink9099' },
        date: 1,
        chat: { id: 111, type: 'private', username: 'hosseink9099' },
        text: '/timer 10m'
      }
    }
  ],
  sent: [],
  offset: 0
};

const storage = {
  settings: { username: 'hosseink9099' },
  baleUsers: {},
  baleOffset: 0
};

const fakeFetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.pathname.endsWith('/getUpdates')) {
    const offset = parseInt(u.searchParams.get('offset') || '0', 10);
    const result = BALE.updates.filter((x) => x.update_id >= offset);
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }
  if (u.pathname.endsWith('/getMe')) {
    return new Response(JSON.stringify({ ok: true, result: { id: 9, username: 'timery_bot', first_name: 'timery_bot' } }), { status: 200 });
  }
  if (u.pathname.endsWith('/sendMessage')) {
    const body = JSON.parse(options.body || '{}');
    BALE.sent.push(body);
    // بله فقط به @username یا chat_id عددی معتبر پاسخ می‌دهد
    const valid = body.chat_id === '@hosseink9099' || String(body.chat_id) === '111';
    return new Response(
      JSON.stringify(valid ? { ok: true, result: { message_id: BALE.sent.length } } : { ok: false, description: 'chat not found' }),
      { status: valid ? 200 : 400 }
    );
  }
  return new Response(JSON.stringify({ ok: false, description: 'not found' }), { status: 404 });
};

const ctx = {
  console, Response, Request, URL, JSON, Object, Array, String, Number, Boolean, Date, Math,
  setTimeout, clearTimeout, setInterval, clearInterval, Promise, AbortController, fetch: fakeFetch
};
ctx.self = ctx;
ctx.TIMERY_CONFIG = { allowDirectToken: true, baleToken: '123456:FAKE_TOKEN_FOR_TEST', botUsername: '@timery_bot' };
ctx.chrome = {
  runtime: { getManifest: () => ({ version: '3.2.0' }) },
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        list.forEach((k) => { if (storage[k] !== undefined) out[k] = storage[k]; });
        return out;
      },
      async set(obj) { Object.assign(storage, obj); }
    }
  }
};
vm.createContext(ctx);

// فقط بخش‌های لازم را از سرویس‌ورکر جدا و ارزیابی می‌کنیم
const sw = fs.readFileSync(path.join(root, 'service_worker.js'), 'utf8');

function extract(name) {
  const re = new RegExp('(async )?function ' + name + '\\([^)]*\\)\\s*\\{');
  const m = sw.match(re);
  if (!m) throw new Error('تابع ' + name + ' پیدا نشد');
  const start = m.index;
  // تا هم‌سطح شدن آکولادها ادامه می‌دهیم
  let depth = 0, i = sw.indexOf('{', start), end = i;
  for (; i < sw.length; i++) {
    if (sw[i] === '{') depth++;
    else if (sw[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return sw.slice(start, end);
}

const pieces = [
  'pad', 'fa', 'normalizeUsername', 'isDirectMode', 'parseBaleUpdate',
  'getBaleUsers', 'rememberBaleUser', 'fetchBaleUpdates', 'resolveDirectChatId',
  'baleApi', 'parseBaleCommand', 'parseDurationArg', 'formatClock'
].map(extract).join('\n\n');

vm.runInContext('const CONFIG = (typeof TIMERY_CONFIG !== "undefined" && TIMERY_CONFIG) || {};\nconst BALE_API = "https://tapi.bale.ai/bot";\n' + pieces + '\nthis.api = { resolveDirectChatId, fetchBaleUpdates, rememberBaleUser, parseBaleCommand, parseBaleUpdate, isDirectMode, parseDurationArg, formatClock, __baleApi: baleApi };', ctx, { filename: 'sw-parts.js' });
const api = ctx.api;

(async () => {
  console.log('\n🤖 روش مستقیم (بدون سرور)');

  ok(api.isDirectMode() === true, 'حالت مستقیم فعال است');

  const resolved = await api.resolveDirectChatId('hosseink9099');
  ok(resolved.found === true, 'کاربر با یوزرنیم پیدا شد');
  ok(resolved.chatId === '111', 'chat_id درست: ' + resolved.chatId);

  const wrong = await api.resolveDirectChatId('someone_else');
  ok(wrong.found === false, 'یوزرنیم اشتباه پیدا نمی‌شود');
  ok(Array.isArray(wrong.seen) && wrong.seen.includes('hosseink9099'),
    'یوزرنیم درست در پیشنهادها هست: ' + JSON.stringify(wrong.seen));

  const cached = await api.resolveDirectChatId('hosseink9099');
  ok(cached.found === true, 'از حافظهٔ کش استفاده می‌شود');

  console.log('\n📝 فرمان‌ها');
  ok(api.parseBaleCommand('/timer 10m').type === 'start_timer', '/timer 10m');
  ok(api.parseBaleCommand('/list').type === 'list_timers', '/list');
  ok(api.parseBaleCommand('/stop').type === 'stop_timers', '/stop');
  ok(api.parseBaleCommand('/status').type === 'status', '/status');
  ok(api.parseBaleCommand('/remind 9:00 تست').type === 'add_reminder', '/remind');
  ok(api.parseBaleCommand('سلام') === null, 'پیام معمولی فرمان نیست');

  console.log('\n⏱ تحلیل زمان');
  ok(api.parseDurationArg('10m') === 600, '10m → ۶۰۰');
  ok(api.parseDurationArg('25 دقیقه') === 1500, '۲۵ دقیقه → ۱۵۰۰');
  ok(api.parseDurationArg('1:30') === 90, '1:30 → ۹۰');
  ok(api.parseDurationArg('نامعتبر') === null, 'ورودی نامعتبر → null');

  console.log('\n📥 خواندن پیام‌ها');
  // offset را صفر می‌کنیم تا پیام‌های قبلی دوباره خوانده شوند
  storage.baleOffset = 0;
  const { updates, ok: fetchOk } = await api.fetchBaleUpdates();
  ok(fetchOk === true && updates.length >= 1, 'پیام‌های ربات خوانده شد');
  const parsed = api.parseBaleUpdate(updates[0]);
  ok(parsed.username === 'hosseink9099', 'یوزرنیم از پیام استخراج شد');
  ok(parsed.chatId === 111, 'chat_id از پیام استخراج شد');
  ok(parsed.text === '/timer 10m', 'متن پیام درست است');

  console.log('\n📨 ارسال مستقیم با یوزرنیم');
  // مسیر ارسال: اول با @username، بعد در صورت نیاز با chat_id عددی
  const sendText = async (user) => {
    const byUsername = await ctx.__baleApi('sendMessage', {
      method: 'POST',
      body: JSON.stringify({ chat_id: '@' + user, text: 'سلام' })
    }, 12000);
    if (byUsername.status === 200 && byUsername.data.ok) return { ok: true, via: 'username' };
    const resolved = await api.resolveDirectChatId(user);
    if (!resolved.found) return { ok: false, via: 'none' };
    const byId = await ctx.__baleApi('sendMessage', {
      method: 'POST',
      body: JSON.stringify({ chat_id: resolved.chatId, text: 'سلام' })
    }, 12000);
    return { ok: byId.status === 200 && byId.data.ok, via: 'chat_id' };
  };
  ctx.__baleApi = api.__baleApi;

  const sent1 = await sendText('hosseink9099');
  ok(sent1.ok === true, 'پیام با یوزرنیم ارسال شد');
  ok(sent1.via === 'username', 'مسیر اصلی: ارسال مستقیم با @username (بدون نیاز به پیام قبلی کاربر)');
  ok(BALE.sent[BALE.sent.length - 1].chat_id === '@hosseink9099', 'chat_id همان @username است');

  const sent2 = await sendText('unknown_user');
  ok(sent2.ok === false, 'یوزرنیم ناشناخته → ارسال ناموفق');

  console.log(`\n${failed === 0 ? '✅' : '❌'} نتیجه: ${passed} موفق، ${failed} ناموفق\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
