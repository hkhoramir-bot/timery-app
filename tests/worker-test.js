/**
 * تست محلی Worker بدون Cloudflare — شبیه‌سازی درخواست‌ها
 * اجرا: node tests/worker-test.js
 *
 * این تست «قانون پلتفرم» را تضمین می‌کند:
 *   ربات بله/تلگرام نمی‌تواند با @username به چت خصوصی پیام بدهد.
 *   پس تا وقتی کاربر /start نزده، هیچ ارسالی نباید انجام شود.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'worker', 'bale-worker.js'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label); }
}

/* ---- شبیه‌سازی API بله ---- */
const BALE = {
  sent: [],
  markdownFails: false,
  bot: { ok: true, result: { id: 1625635207, username: 'timery_bot', first_name: 'timery_bot' } }
};

const env = {
  BALE_TOKEN: 'TEST_TOKEN',
  TIMERY_KEYS: 'TIMERY-A1B2C3,TIMERY-D4E5F6',
  WEBHOOK_SECRET: 'HOOKSECRET',
  BOT_USERNAME: '@timery_bot',
  CHATS: {
    _data: {},
    async get(k) { return this._data[k] === undefined ? null : this._data[k]; },
    async put(k, v) { this._data[k] = v; },
    async delete(k) { delete this._data[k]; }
  }
};

const mockFetch = async (url, options = {}) => {
  const u = new URL(url);
  const method = u.pathname.split('/').pop();

  if (method === 'getMe') {
    return new Response(JSON.stringify(BALE.bot), { status: 200 });
  }
  if (method === 'getWebhookInfo') {
    return new Response(JSON.stringify({ ok: true, result: { url: 'https://worker.test/bale/hook' } }), { status: 200 });
  }
  if (method === 'sendMessage') {
    const body = JSON.parse(options.body || '{}');
    if (BALE.markdownFails && body.parse_mode) {
      return new Response(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }), { status: 400 });
    }
    BALE.sent.push(body);
    return new Response(JSON.stringify({ ok: true, result: { message_id: BALE.sent.length } }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: false, description: 'not found' }), { status: 404 });
};

const ctx = {
  console, Response, Request, URL, JSON, Object, Array, String, Number, Boolean,
  Date, Math, setTimeout, clearTimeout, Promise, AbortController,
  crypto: webcrypto, fetch: mockFetch
};
ctx.self = ctx;
ctx.module = { exports: {} };
vm.createContext(ctx);
vm.runInContext(code.replace('export default {', 'module.exports = {'), ctx, { filename: 'bale-worker.js' });
const worker = ctx.module.exports;

async function call(path, options = {}) {
  const url = 'https://worker.test' + path;
  const headers = options.headers || {};
  const body = options.body || '';

  const request = {
    url,
    method: options.method || 'GET',
    headers: {
      get: (k) => {
        const found = Object.keys(headers).find((h) => h.toLowerCase() === k.toLowerCase());
        return found ? headers[found] : null;
      }
    },
    text: async () => body,
    json: async () => JSON.parse(body || '{}')
  };

  const res = await worker.fetch(request, env);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* noop */ }
  return { status: res.status, json, text };
}

const KEY = { 'x-timery-key': 'TIMERY-A1B2C3' };

/** ساخت آپدیت بله برای یک کاربر */
function update(chatId, username, text) {
  return {
    update_id: Math.floor(Math.random() * 100000),
    message: {
      message_id: 1,
      from: { id: chatId, is_bot: false, first_name: username, username },
      chat: { id: chatId, type: 'private', username, first_name: username },
      text
    }
  };
}

async function hook(payload, secret) {
  const q = secret === undefined ? 'HOOKSECRET' : secret;
  return call(`/bale/hook?k=${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

(async () => {
  console.log('\n🔐 احراز هویت (توکن پشت توکن)');

  const noKey = await call('/status?username=ali');
  ok(noKey.status === 401 && noKey.json.reason === 'missing_header', 'بدون کلید → 401');

  const badKey = await call('/status?username=ali', { headers: { 'x-timery-key': 'WRONG' } });
  ok(badKey.status === 401 && badKey.json.reason === 'mismatch', 'کلید نامعتبر → 401');

  const realToken = await call('/status?username=ali', { headers: { 'x-timery-key': 'TEST_TOKEN' } });
  ok(realToken.status === 401, 'توکن واقعی بات هم کلید مجاز نیست → 401 (امنیت)');

  const goodKey = await call('/status?username=ali', { headers: KEY });
  ok(goodKey.status === 200 && goodKey.json.ok, 'کلید ساختگی معتبر → 200');

  const keyInQuery = await call('/status?username=ali&key=TIMERY-A1B2C3');
  ok(keyInQuery.status === 200, 'کلید در آدرس (?key=) هم پذیرفته می‌شود');

  console.log('\n🚫 قانون پلتفرم: بدون /start هیچ ارسالی ممکن نیست');

  const beforePair = await call('/send', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ username: 'ali', text: 'سلام' })
  });
  ok(beforePair.status === 409 && beforePair.json.error === 'not_linked', 'کاربر وصل‌نشده → 409 not_linked');
  ok(BALE.sent.length === 0, 'هیچ پیامی ارسال نشد');
  ok(!BALE.sent.some((s) => String(s.chat_id).startsWith('@')), 'هرگز با @username ارسال نشد');

  console.log('\n🔗 جریان اتصال (کد یک‌بارمصرف)');

  const pair = await call('/pair/start', { method: 'POST', headers: KEY, body: '{}' });
  ok(pair.json.ok && /^[A-Z0-9]{6}$/.test(pair.json.code), 'کد ۶ رقمی ساخته شد: ' + pair.json.code);
  ok(pair.json.deepLink === `https://ble.ir/timery_bot?start=${pair.json.code}`, 'deep link درست است');
  ok(pair.json.fallbackCommand === `/start ${pair.json.code}`, 'فرمان دستی پشتیبان موجود است');

  const checkBefore = await call('/pair/check?code=' + pair.json.code, { headers: KEY });
  ok(checkBefore.json.linked === false, 'قبل از تأیید: linked=false');

  const wrongHook = await hook(update(111, 'ali', `/start ${pair.json.code}`), 'WRONG');
  ok(wrongHook.status === 403, 'webhook با رمز غلط → 403');

  const startHook = await hook(update(111, 'ali', `/start ${pair.json.code}`));
  ok(startHook.status === 200, 'webhook /start را پذیرفت');
  ok(BALE.sent.some((s) => String(s.chat_id) === '111'), 'پیام تأیید به chat_id عددی رفت');

  const checkAfter = await call('/pair/check?code=' + pair.json.code, { headers: KEY });
  ok(checkAfter.json.linked === true, 'بعد از تأیید: linked=true');
  ok(checkAfter.json.chatId === '111', 'chat_id ذخیره شد: ' + checkAfter.json.chatId);
  ok(checkAfter.json.username === 'ali', 'یوزرنیم واقعی از بله گرفته شد');

  console.log('\n📤 ارسال پیام (با chat_id عددی)');

  const send1 = await call('/send', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ username: 'ali', text: 'سلام' })
  });
  ok(send1.status === 200 && send1.json.ok, 'ارسال بعد از اتصال موفق است');
  const last = BALE.sent[BALE.sent.length - 1];
  ok(String(last.chat_id) === '111', 'با chat_id عددی ارسال شد (نه @username)');

  const sendByChatId = await call('/send', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ chatId: '111', text: 'تست با chatId' })
  });
  ok(sendByChatId.json.ok && sendByChatId.json.chatId === '111', 'ارسال با chatId مستقیم هم کار می‌کند');

  BALE.markdownFails = true;
  const send2 = await call('/send', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ username: 'ali', text: '*متن*' })
  });
  ok(send2.json.ok && send2.json.downgraded === true, 'خطای Markdown → خودکار با متن ساده دوباره تلاش شد');
  BALE.markdownFails = false;

  console.log('\n🤖 فرمان‌ها');

  await hook(update(111, 'ali', '/timer 10m'));
  const cmds = await call('/commands?username=ali', { headers: KEY });
  ok(cmds.json.ok && cmds.json.commands.length === 1, 'فرمان /timer در صف قرار گرفت');
  ok(cmds.json.commands[0].type === 'start_timer', 'نوع فرمان درست است: ' + cmds.json.commands[0].type);

  const cmdsAgain = await call('/commands?username=ali', { headers: KEY });
  ok(cmdsAgain.json.commands.length === 0, 'صف بعد از خواندن خالی شد (بدون تکرار)');

  console.log('\n🔁 کد تکراری و نامعتبر');

  const reused = await hook(update(222, 'reza', `/start ${pair.json.code}`));
  ok(reused.status === 200, 'webhook کد تکراری را می‌پذیرد ولی...');
  const pairOwner = await call('/pair/check?code=' + pair.json.code, { headers: KEY });
  ok(pairOwner.json.chatId === '111', '...کد همچنان مال صاحب اولش است (کد دزدیده نمی‌شود)');
  const rezaSend = await call('/send', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ username: 'reza', text: 'تست' })
  });
  ok(rezaSend.json.chatId === '222', '...و رضا فقط با chat_id خودش قابل ارسال است');

  const badCode = await call('/pair/check?code=ZZZZZZ', { headers: KEY });
  ok(badCode.json.ok && badCode.json.linked === false && badCode.json.expired === true, 'کد نامعتبر → expired');

  console.log('\n🩺 سلامت');

  const health = await call('/health');
  ok(health.json.ok && health.json.tokenConfigured === true, '/health بدون کلید کار می‌کند');
  ok(health.json.keyConfigured === true, 'keyConfigured درست است');
  ok(health.json.kvConfigured === true, 'kvConfigured درست است');
  ok(health.json.webhookConfigured === true, 'webhookConfigured درست است');

  console.log(`\n${failed === 0 ? '✅' : '❌'} نتیجه: ${passed} موفق، ${failed} ناموفق\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
