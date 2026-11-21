/**
 * Timery — Bale Relay (Cloudflare Worker) v3
 * ==================================================================
 * چرا نسخهٔ ۳؟ چون نسخهٔ قبلی یک فرض غلط داشت:
 *
 *   ❌ فرض قبلی: «ربات می‌تواند با یوزرنیم (@username) به کاربر پیام بدهد.»
 *   ✅ واقعیت بله/تلگرام: ربات فقط به کانال‌ها با @username پیام می‌دهد.
 *      برای «چت خصوصی» حتماً باید chat_id عددی داشته باشد، و آن هم
 *      فقط بعد از اینکه کاربر خودش یک‌بار به ربات پیام داده باشد به دست می‌آید.
 *
 * پس مسیر درست این است:
 *   ۱) افزونه یک «کد اتصال» یک‌بارمصرف می‌سازد
 *   ۲) کاربر لینک  https://ble.ir/<bot>?start=<CODE>  را باز می‌کند
 *   ۳) بله خودش  /start <CODE>  را به ربات می‌فرستد
 *   ۴) webhook همین Worker پیام را می‌گیرد و «یوزرنیم + chat_id عددی» را ذخیره می‌کند
 *   ۵) از این به بعد همهٔ ارسال‌ها با chat_id عددی انجام می‌شود → همیشه کار می‌کند
 *
 * Secret ها:
 *   wrangler secret put BALE_TOKEN        توکن ربات
 *   wrangler secret put TIMERY_KEY        کلید مشترک با افزونه (js/config.js)
 *   wrangler secret put WEBHOOK_SECRET    (اختیاری) رمز مسیر webhook
 *
 * KV (عملاً الزامی برای اتصال پایدار): نام CHATS
 *   wrangler kv namespace create CHATS
 */

const BALE_API = 'https://tapi.bale.ai/bot';
const MAX_TEXT = 4000;
const RATE_LIMIT_PER_HOUR = 120;
const PAIR_TTL = 900;              // ۱۵ دقیقه
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون I,O,0,1

/* ==================== ابزارهای عمومی ==================== */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-timery-key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    }
  });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-timery-key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400'
    }
  });
}

function normalizeUsername(raw) {
  return String(raw || '').trim().replace(/^@+/, '').toLowerCase();
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** کد تصادفی امن (بدون حروف/ارقام گیج‌کننده) */
function makeCode(len = 6) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function validKeys(env) {
  const list = [];
  if (env.TIMERY_KEYS) {
    String(env.TIMERY_KEYS).split(',').map((s) => s.trim()).filter(Boolean).forEach((k) => list.push(k));
  }
  if (env.TIMERY_KEY && env.TIMERY_KEY.trim()) list.push(env.TIMERY_KEY.trim());
  return list;
}

function isAuthorized(request, env, url) {
  const allowed = validKeys(env);
  if (!allowed.length) return { ok: false, reason: 'missing_secret' };

  const provided = request.headers.get('x-timery-key') ||
    (url && url.searchParams.get('key')) ||
    (url && url.searchParams.get('apikey'));

  if (!provided) return { ok: false, reason: 'missing_header' };
  if (!allowed.includes(String(provided).trim())) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

function webhookSecret(env) {
  return String(env.WEBHOOK_SECRET || env.TIMERY_KEY || '').trim();
}

/* ==================== ذخیره‌سازی ==================== */

const memory = new Map();

async function kvGet(env, key) {
  if (env.CHATS && typeof env.CHATS.get === 'function') {
    const v = await env.CHATS.get(key);
    return v === null || v === undefined ? null : v;
  }
  return memory.has(key) ? memory.get(key) : null;
}

async function kvSet(env, key, value, ttlSeconds) {
  if (env.CHATS && typeof env.CHATS.put === 'function') {
    await env.CHATS.put(key, value, ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
    return;
  }
  memory.set(key, value);
}

async function kvDelete(env, key) {
  if (env.CHATS && typeof env.CHATS.delete === 'function') {
    await env.CHATS.delete(key);
    return;
  }
  memory.delete(key);
}

async function kvGetJson(env, key, fallback) {
  try {
    const raw = await kvGet(env, key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/* ==================== نگاشت کاربران ==================== */

/**
 * دو نگاشت جدا نگه می‌داریم:
 *   users:  «یوزرنیم → chat_id»  (برای جست‌وجوی افزونه)
 *   chats:  «chat_id → {username, firstName}» (برای فرمان‌های ورودی)
 */
const USERS_KEY = 'users';

async function getUsersMap(env) {
  const map = await kvGetJson(env, USERS_KEY, {});
  return map && typeof map === 'object' ? map : {};
}

async function rememberUser(env, username, chatId, firstName) {
  const cid = chatId === null || chatId === undefined ? '' : String(chatId);
  if (!cid) return;

  const users = await getUsersMap(env);
  let dirty = false;

  if (username && users[username] !== cid) {
    users[username] = cid;
    dirty = true;
  }

  if (dirty) {
    const keys = Object.keys(users);
    if (keys.length > 500) {
      for (const k of keys.slice(0, keys.length - 500)) delete users[k];
    }
    await kvSet(env, USERS_KEY, JSON.stringify(users));
  }

  if (username || firstName) {
    await kvSet(env, `chat:${cid}`, JSON.stringify({
      username: username || '',
      firstName: firstName || '',
      at: Date.now()
    }));
  }
}

async function chatIdFor(env, username) {
  if (!username) return null;
  const users = await getUsersMap(env);
  return users[username] ? String(users[username]) : null;
}

/* ==================== API بله ==================== */

async function baleCall(env, method, payload, timeoutMs) {
  const url = `${BALE_API}${env.BALE_TOKEN}/${method}`;
  const options = { method: 'GET', headers: { 'Content-Type': 'application/json' } };
  if (payload) {
    options.method = 'POST';
    options.body = JSON.stringify(payload);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { ok: false, description: raw.slice(0, 300) };
    }
    return { status: res.status, data };
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    return {
      status: 0,
      data: { ok: false, description: timedOut ? 'timeout' : String(error && error.message) }
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ارسال پیام به یک chat_id عددی.
 * اگر Markdown خراب باشد (خطای can't parse entities) با متن ساده دوباره تلاش می‌کنیم —
 * این یکی از رایج‌ترین دلایل «ارسال ناموفق» در بله است.
 */
async function sendMessage(env, chatId, text, parseMode) {
  const body = { chat_id: chatId, text: String(text).slice(0, MAX_TEXT) };
  if (parseMode) body.parse_mode = parseMode;

  const first = await baleCall(env, 'sendMessage', body, 10000);
  if (first.status === 200 && first.data && first.data.ok) {
    return { ok: true, data: first.data };
  }

  const desc = String((first.data && first.data.description) || '');
  const looksLikeParseError = /parse|entit|markdown|can't find end/i.test(desc);

  if (parseMode && looksLikeParseError) {
    const plain = await baleCall(env, 'sendMessage', {
      chat_id: chatId,
      text: String(text).slice(0, MAX_TEXT)
    }, 10000);
    if (plain.status === 200 && plain.data && plain.data.ok) {
      return { ok: true, data: plain.data, downgraded: true };
    }
    return { ok: false, error: (plain.data && plain.data.description) || 'send_failed' };
  }

  return { ok: false, error: desc || ('HTTP ' + first.status) };
}

async function getBotInfo(env) {
  const fallback = {
    username: env.BOT_USERNAME || '',
    firstName: env.BOT_NAME || '',
    ok: false
  };

  const { status, data } = await baleCall(env, 'getMe', null, 8000);
  if (status === 200 && data && data.ok && data.result) {
    const r = data.result;
    return {
      ok: true,
      id: r.id || null,
      username: r.username || fallback.username,
      firstName: r.first_name || r.firstName || fallback.firstName
    };
  }
  return fallback;
}

function botLink(botUsername, code) {
  const u = normalizeUsername(botUsername);
  if (!u) return '';
  return `https://ble.ir/${u}?start=${encodeURIComponent(code)}`;
}

/* ==================== پیام‌های ثابت ==================== */

const WELCOME = [
  '👋 *به Timery خوش آمدید!*',
  '━━━━━━━━━━━━━━━',
  'من تایمر، یادآور و پومودوروی مرورگر شما هستم.',
  '',
  '⏱  /timer 10m ▸ شروع تایمر',
  '📋  /list ▸ لیست تایمرها',
  '🛑  /stop ▸ توقف همه',
  '📊  /status ▸ وضعیت کامل',
  '🔔  /remind 9:00 متن ▸ ساخت یادآور',
  '━━━━━━━━━━━━━━━',
  'برای اتصال به افزونه، کد ۶ رقمی را که افزونه نشان می‌دهد بفرستید:',
  '/start ABC123'
].join('\n');

const PAIR_OK = [
  '✅ *اتصال با موفقیت انجام شد!*',
  '',
  'از این لحظه تایمرها و یادآورهای افزونه به همین چت می‌آیند',
  'و می‌توانید مرورگرتان را از همین‌جا کنترل کنید.',
  '',
  'یک تست: /status'
].join('\n');

/* ==================== اتصال (Pairing) ==================== */

async function startPairing(env, hintUsername) {
  const code = makeCode(6);
  const record = {
    code,
    hint: normalizeUsername(hintUsername),
    createdAt: Date.now()
  };
  await kvSet(env, `pair:${code}`, JSON.stringify(record), PAIR_TTL);

  const bot = await getBotInfo(env);
  const deepLink = botLink(bot.username, code);

  return {
    ok: true,
    code,
    deepLink,
    fallbackCommand: `/start ${code}`,
    expiresIn: PAIR_TTL,
    bot: { username: bot.username, firstName: bot.firstName },
    kvConfigured: Boolean(env.CHATS),
    warning: env.CHATS ? undefined : 'kv_missing'
  };
}

async function checkPairing(env, codeRaw) {
  const code = normalizeCode(codeRaw);
  if (!code) return { ok: false, error: 'code_required' };

  const record = await kvGetJson(env, `pair:${code}`, null);
  if (!record) return { ok: true, linked: false, expired: true, code };

  if (!record.chatId) {
    return { ok: true, linked: false, expired: false, code };
  }

  const bot = await getBotInfo(env);
  return {
    ok: true,
    linked: true,
    code,
    chatId: String(record.chatId),
    username: record.username || '',
    firstName: record.firstName || '',
    linkedAt: record.linkedAt || null,
    bot: { username: bot.username, firstName: bot.firstName }
  };
}

/** اتصال کد به یک چت — خروجی: { ok, reason } */
async function bindPairing(env, codeRaw, chatId, username, firstName) {
  const code = normalizeCode(codeRaw);
  if (!code) return { ok: false, reason: 'empty' };

  const record = await kvGetJson(env, `pair:${code}`, null);
  if (!record) return { ok: false, reason: 'expired' };

  // اگر این کد قبلاً به چت دیگری وصل شده، اجازهٔ دزدیدنش را نمی‌دهیم
  if (record.chatId && String(record.chatId) !== String(chatId)) {
    return { ok: false, reason: 'already_used' };
  }

  record.chatId = String(chatId);
  record.username = username || record.username || '';
  record.firstName = firstName || record.firstName || '';
  record.linkedAt = Date.now();

  await kvSet(env, `pair:${code}`, JSON.stringify(record), PAIR_TTL);
  await rememberUser(env, record.username, chatId, record.firstName);

  return { ok: true, code, username: record.username };
}

/* ==================== فرمان‌ها ==================== */

function parseCommand(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('/')) return null;

  const [rawCmd, ...rest] = t.slice(1).split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@\w+$/, ''); // /timer@botname
  const arg = rest.join(' ').trim();

  if (cmd === 'timer' || cmd === 't') return { type: 'start_timer', arg };
  if (cmd === 'stop' || cmd === 's') return { type: 'stop_timers', arg: '' };
  if (cmd === 'list' || cmd === 'l') return { type: 'list_timers', arg: '' };
  if (cmd === 'status' || cmd === 'st') return { type: 'status', arg: '' };
  if (cmd === 'remind' || cmd === 'r') return { type: 'add_reminder', arg };
  if (cmd === 'help' || cmd === 'h' || cmd === 'start') return { type: 'help', arg: '' };
  return { type: 'unknown', arg: cmd };
}

async function pushCommand(env, chatId, username, parsed, text) {
  const key = `cmd:${chatId}`;
  const list = await kvGetJson(env, key, []);
  list.push({
    id: Date.now(),
    type: parsed.type,
    arg: parsed.arg,
    text,
    username,
    at: Date.now()
  });
  await kvSet(env, key, JSON.stringify(list.slice(-30)), 86400);
}

/* ==================== Webhook ==================== */

/**
 * ثبت هر تماس webhook برای عیب‌یابی.
 * اگر پیام‌های کاربر در بله ثبت می‌شوند ولی اینجا خالی است،
 * یعنی بله اصلاً به Worker نمی‌رسد (مشکل شبکه/فیلتر).
 */
async function logHook(env, entry) {
  try {
    const list = await kvGetJson(env, 'hooklog', []);
    list.push(entry);
    await kvSet(env, 'hooklog', JSON.stringify(list.slice(-20)), 86400);
  } catch { /* لاگ نباید جریان اصلی را بشکند */ }
}

/**
 * پردازش واقعی یک آپدیت.
 *
 * ⚠️ این تابع عمداً از پاسخ webhook جدا شده است: بله انتظار دارد ظرف چند صد
 * میلی‌ثانیه ۲۰۰ بگیرد، ولی فرستادن پیام و نوشتن KV ممکن است بیشتر طول بکشد.
 * اگر دیر جواب بدهیم، بله تحویل را ناموفق می‌شمارد و در صف دوباره تلاش می‌کند
 * (همان `pending_update_count` که مدام بالا می‌رفت).
 */
async function processUpdate(env, update) {
  const msg = update.message || update.edited_message || update.channel_post || null;
  if (!msg) return;

  const chat = msg.chat || {};
  const from = msg.from || {};
  const chatId = chat.id ?? from.id ?? null;
  const username = normalizeUsername(chat.username || from.username || '');
  const firstName = from.first_name || chat.first_name || '';
  const text = String(msg.text || msg.caption || '');

  await logHook(env, {
    at: Date.now(),
    updateId: update.update_id ?? null,
    chatId: chatId ? String(chatId) : null,
    username: username || null,
    text: text.slice(0, 80)
  });

  if (!chatId) return;

  // همیشه نگاشت را تازه نگه می‌داریم — حتی اگر فقط سلام کرده باشد
  await rememberUser(env, username, chatId, firstName);

  const cmdMatch = text.match(/^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  const cmdName = cmdMatch ? cmdMatch[1].toLowerCase() : '';
  const cmdArg = cmdMatch ? String(cmdMatch[2] || '').trim() : '';

  // ---------- /start <CODE> یا /link <CODE> ----------
  if (cmdName === 'start' || cmdName === 'link') {
    const code = normalizeCode(cmdArg);

    if (code) {
      const bound = await bindPairing(env, code, chatId, username, firstName);
      if (bound.ok) {
        await sendMessage(env, chatId, PAIR_OK, 'Markdown');
        return;
      }
      const reasons = {
        expired: '⛔️ این کد معتبر نیست یا منقضی شده. یک کد تازه از افزونه بگیرید.',
        already_used: '⛔️ این کد قبلاً استفاده شده است.',
        empty: 'کد را بعد از /start بنویسید. مثال:\n/start ABC123'
      };
      await sendMessage(env, chatId, reasons[bound.reason] || '⛔️ اتصال ناموفق بود.', null);
      return;
    }

    await sendMessage(env, chatId, WELCOME, 'Markdown');
    return;
  }

  // ---------- پیام متنی که فقط «کد» است ----------
  const bareCode = normalizeCode(text);
  if (!cmdMatch && bareCode.length >= 4 && bareCode.length <= 10) {
    const bound = await bindPairing(env, bareCode, chatId, username, firstName);
    if (bound.ok) {
      await sendMessage(env, chatId, PAIR_OK, 'Markdown');
      return;
    }
  }

  // ---------- سایر فرمان‌ها → صف افزونه ----------
  const parsed = parseCommand(text);
  if (parsed) {
    await pushCommand(env, chatId, username, parsed, text);
    if (parsed.type === 'unknown') {
      await sendMessage(env, chatId, '🤔 این فرمان را نمی‌شناسم.\n/help را بفرستید.', null);
    }
  }
}

async function handleWebhook(request, env, url, ctx) {
  const secret = webhookSecret(env);
  if (secret) {
    const provided = url.searchParams.get('k') ||
      request.headers.get('x-telegram-bot-api-secret-token') || '';
    if (provided !== secret) return json({ ok: false, error: 'forbidden' }, 403);
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return json({ ok: true });
  }

  // ⭐️ فوراً ۲۰۰ برمی‌گردانیم و کار را در پس‌زمینه انجام می‌دهیم
  const task = processUpdate(env, update).catch((e) => {
    console.error('processUpdate failed', e && e.message);
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(task);
  } else {
    await task; // محیط تست
  }

  return json({ ok: true });
}

/* ==================== محدودیت نرخ ==================== */

async function checkRateLimit(env, key) {
  const bucket = Math.floor(Date.now() / 3600000);
  const k = `rl:${key}:${bucket}`;
  const current = parseInt((await kvGet(env, k)) || '0', 10);
  if (current >= RATE_LIMIT_PER_HOUR) return false;
  await kvSet(env, k, String(current + 1), 7200);
  return true;
}

/* ==================== مسیرها ==================== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return corsPreflight();

    /* ---------- webhook بله (بدون کلید افزونه؛ با رمز خودش) ---------- */
    if (path === '/bale/hook') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return handleWebhook(request, env, url, ctx);
    }

    /* ---------- سلامت ---------- */
    if (path === '/health') {
      const keys = validKeys(env);
      const bot = await getBotInfo(env);
      let webhook = null;
      try {
        const info = await baleCall(env, 'getWebhookInfo', null, 6000);
        if (info.data && info.data.ok) webhook = info.data.result;
      } catch { /* بی‌اهمیت */ }

      return json({
        ok: true,
        service: 'timery-bale-relay',
        version: 5,
        tokenConfigured: Boolean(env.BALE_TOKEN),
        keyConfigured: keys.length > 0,
        keyCount: keys.length,
        kvConfigured: Boolean(env.CHATS),
        webhookConfigured: Boolean(webhook && webhook.url),
        webhookUrl: webhook ? webhook.url : '',
        bot: { username: bot.username, firstName: bot.firstName },
        time: new Date().toISOString()
      });
    }

    /* ---------- احراز هویت بقیهٔ مسیرها ---------- */
    const auth = isAuthorized(request, env, url);
    if (!auth.ok) {
      const messages = {
        missing_secret: 'سکرت TIMERY_KEY روی Worker ثبت نشده است',
        missing_header: 'هدر x-timery-key ارسال نشده است',
        mismatch: 'کلید ارسالی با TIMERY_KEY مطابقت ندارد'
      };
      return json({ ok: false, error: 'unauthorized', reason: auth.reason, message: messages[auth.reason] }, 401);
    }

    /* ---------- هویت ربات ---------- */
    if (path === '/bot') {
      const bot = await getBotInfo(env);
      return json({ ok: true, bot, deepLinkBase: bot.username ? `https://ble.ir/${normalizeUsername(bot.username)}` : '' });
    }

    /* ---------- ساخت کد اتصال ---------- */
    if (path === '/pair/start') {
      let hint = url.searchParams.get('username') || '';
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        hint = hint || body.username || '';
      }
      const result = await startPairing(env, hint);
      return json(result);
    }

    /* ---------- بررسی وضعیت کد ---------- */
    if (path === '/pair/check') {
      const result = await checkPairing(env, url.searchParams.get('code'));
      return json(result, result.ok === false && result.error === 'code_required' ? 400 : 200);
    }

    /* ---------- وضعیت کاربر ---------- */
    if (path === '/status') {
      const username = normalizeUsername(url.searchParams.get('username'));
      const code = url.searchParams.get('code');
      const bot = await getBotInfo(env);

      if (!username && code) {
        const pair = await checkPairing(env, code);
        return json({ ...pair, bot: pair.bot || { username: bot.username, firstName: bot.firstName } });
      }

      if (!username) return json({ ok: false, error: 'username_required' }, 400);

      const chatId = await chatIdFor(env, username);
      const users = await getUsersMap(env);

      return json({
        ok: true,
        username,
        linked: Boolean(chatId),
        chatId: chatId || null,
        bot: { username: bot.username, firstName: bot.firstName },
        seenUsernames: Object.keys(users).slice(-20),
        hint: chatId
          ? 'متصل ✓'
          : 'این یوزرنیم به هیچ چتی وصل نیست — از «اتصال به بله» در افزونه استفاده کنید.'
      });
    }

    /* ---------- ارسال پیام ---------- */
    if (path === '/send') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

      let payload = {};
      try {
        const raw = await request.text();
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = {};
      }

      const username = normalizeUsername(payload.username);
      const text = String(payload.text || '').trim();
      let chatId = payload.chatId ? String(payload.chatId).trim() : '';

      if (!text) return json({ ok: false, error: 'text_required' }, 400);

      // ⭐️ مهم: فقط chat_id عددی معتبر است. هرگز با @username به کاربر پیام نمی‌دهیم.
      if (!chatId) chatId = (await chatIdFor(env, username)) || '';

      if (!chatId) {
        return json({
          ok: false,
          error: 'not_linked',
          needsPairing: true,
          message: 'این کاربر هنوز به ربات وصل نشده است. کاربر باید یک‌بار در بله /start بزند تا chat_id ثبت شود.'
        }, 409);
      }

      if (!(await checkRateLimit(env, chatId))) {
        return json({ ok: false, error: 'rate_limited' }, 429);
      }

      const sent = await sendMessage(env, chatId, text, 'Markdown');
      if (!sent.ok) {
        return json({ ok: false, error: 'bale_error', message: sent.error, chatId }, 502);
      }
      return json({ ok: true, chatId, downgraded: Boolean(sent.downgraded) });
    }

    /* ---------- فرمان‌های ارسالی کاربر ---------- */
    if (path === '/commands') {
      const username = normalizeUsername(url.searchParams.get('username'));
      const direct = url.searchParams.get('chatId');
      if (!username && !direct) return json({ ok: false, error: 'username_required' }, 400);

      const chatId = direct ? String(direct) : await chatIdFor(env, username);
      if (!chatId) return json({ ok: true, username, linked: false, commands: [] });

      const key = `cmd:${chatId}`;
      const list = await kvGetJson(env, key, []);
      await kvDelete(env, key);

      return json({ ok: true, username, chatId, linked: true, commands: list });
    }

    /* ---------- ثبت webhook ---------- */
    if (path === '/admin/webhook') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

      const body = await request.json().catch(() => ({}));

      if (body.delete) {
        const del = await baleCall(env, 'deleteWebhook', null, 8000);
        return json({ ok: Boolean(del.data && del.data.ok), result: del.data });
      }

      const secret = webhookSecret(env);
      if (!secret) {
        return json({ ok: false, error: 'no_secret', message: 'WEBHOOK_SECRET یا TIMERY_KEY را تنظیم کنید' }, 400);
      }

      const hookUrl = body.url || `${url.origin}/bale/hook?k=${encodeURIComponent(secret)}`;
      const res = await baleCall(env, 'setWebhook', { url: hookUrl }, 10000);

      return json({
        ok: Boolean(res.data && res.data.ok),
        url: hookUrl,
        result: res.data
      });
    }

    /* ---------- عیب‌یابی ---------- */
    if (path === '/admin/raw') {
      const method = url.searchParams.get('method');
      if (!method) return json({ ok: false, error: 'method_required' }, 400);

      const params = {};
      for (const [k, v] of url.searchParams) {
        if (k === 'method' || k === 'key' || k === 'apikey') continue;
        params[k] = v;
      }
      const hasParams = Object.keys(params).length > 0;
      const res = await baleCall(env, method, hasParams ? params : null, 12000);
      return json({ ok: true, status: res.status, result: res.data });
    }

    if (path === '/debug') {
      const users = await getUsersMap(env);
      let webhook = null;
      const info = await baleCall(env, 'getWebhookInfo', null, 6000);
      if (info.data && info.data.ok) webhook = info.data.result;

      return json({
        ok: true,
        kvConfigured: Boolean(env.CHATS),
        webhook,
        knownUsers: users,
        userCount: Object.keys(users).length,
        hookLog: await kvGetJson(env, 'hooklog', [])
      });
    }

    return json({ ok: false, error: 'not_found' }, 404);
  }
};
