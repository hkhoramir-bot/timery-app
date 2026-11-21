# ⭐ واسط بله — معماری «توکن پشت توکن» + اتصال با کد

## ❗️ اول این را بخوانید: چرا نسخهٔ قبلی کار نمی‌کرد

API بله بر پایهٔ API تلگرام است و یک محدودیت بنیادی دارد:

> **ربات نمی‌تواند به یک «چت خصوصی» با `@username` پیام بدهد.**

پارامتر `chat_id` در `sendMessage` فقط برای **کانال‌ها** `@channelusername` را می‌پذیرد.
برای کاربر عادی باید **`chat_id` عددی** داشته باشیم، و آن هم فقط بعد از این به دست می‌آید
که کاربر **خودش یک‌بار** به ربات پیام داده باشد (`/start`).

پس این‌ها هیچ‌وقت جواب نمی‌دهند:

- ❌ `sendMessage { chat_id: "@ali" }` → `Bad Request: chat not found`
- ❌ `getChat { chat_id: "@ali" }` → همان خطا (فقط کانال/گروه را می‌شناسد)
- ❌ «اسکن پیام‌های ربات برای پیدا کردن یوزرنیم» → اگر کاربر پیام نداده باشد چیزی نیست،
  و اگر `offset` جلو رفته باشد پیام‌های قدیمی از دست رفته‌اند (بله فقط ۲۴ ساعت / ۲۰۰۰ پیام نگه می‌دارد)

**راه‌حل:** یک مرحلهٔ «اتصال» (pairing) با کد یک‌بارمصرف.

---

## جریان کار

```
┌────────────┐   ۱) /pair/start     ┌──────────────────┐
│  افزونه    │ ───────────────────▶ │ Cloudflare Worker│  کد ۶ رقمی می‌سازد
│            │ ◀─────────────────── │  (KV: pair:CODE) │  deep link برمی‌گرداند
└────────────┘   code + deepLink    └──────────────────┘
      │
      │ ۲) کاربر لینک را باز می‌کند
      ▼
  https://ble.ir/timery_bot?start=AB12CD
      │
      │ ۳) بله خودش /start AB12CD را می‌فرستد
      ▼
┌────────────┐  ۴) POST /bale/hook  ┌──────────────────┐
│    بله     │ ───────────────────▶ │ Cloudflare Worker│  users[ali] = 111
└────────────┘   (webhook)          │  chats[111] = ali│  pair:CODE → chatId
      ▲                             └──────────────────┘
      │ ۵) از این به بعد: sendMessage با chat_id عددی ۱۱۱
      └───────────────────────────────────────────────────

  ۶) افزونه با /pair/check می‌فهمد وصل شده و chat_id را ذخیره می‌کند
```

نکتهٔ کلیدی: **بله** است که پیام اول را می‌فرستد، نه ربات. به همین دلیل هیچ محدودیتی نقض نمی‌شود.

---

## 🔑 توکن کجا زندگی می‌کند؟ (و کجا هرگز نباید باشد)

| محل | چه چیزی | امن؟ |
|---|---|---|
| **Cloudflare Secrets** | `BALE_TOKEN` — توکن واقعی ربات | ✅ فقط روی سرور، رمزنگاری‌شده |
| `worker/wrangler.toml` | نام Worker، بایندینگ KV، `BOT_USERNAME` | ✅ هیچ رمزی ندارد |
| `worker/.dev.vars` | فقط برای `wrangler dev` روی سیستم خودت | ⚠️ در `.gitignore` هست |
| `js/config.js` (داخل افزونه) | `baleKey` = یک **کلید ساختگی** | ✅ بدون سرور بی‌ارزش |
| ❌ هر فایل دیگری | توکن بات | ⛔️ ممنوع |

**دستور `wrangler secret put` فایل نمی‌سازد.** مقدار را تعاملی می‌پرسد و مستقیم
روی Cloudflare ذخیره می‌کند؛ نه در پروژه، نه در تاریخچهٔ ترمینال، نه در بستهٔ افزونه.

اگر کسی افزونه را باز کند و `baleKey` را بردارد، فقط می‌تواند به Worker تو درخواست بدهد —
و آن هم بدون دانستن `TIMERY_KEYS` به 401 می‌خورد. توکن ربات هیچ‌وقت از سرور بیرون نمی‌آید.

علاوه بر این، مسیر «حالت مستقیم» (توکن داخل `config.js`) به‌صورت پیش‌فرض **قفل** است:
تا وقتی `allowDirectToken: true` در `js/config.js` نباشد، حتی اگر کسی توکن را آنجا بگذارد
نادیده گرفته می‌شود.

---

## ۱. ساخت KV (الزامی)

بدون KV، حالت اتصال بین درخواست‌ها گم می‌شود (هر isolate حافظهٔ جدا دارد):

```bash
cd worker
npm i -g wrangler
wrangler login
wrangler kv namespace create CHATS
```

شناسهٔ خروجی را در `worker/wrangler.toml` بگذارید:

```toml
[[kv_namespaces]]
binding = "CHATS"
id = "<شناسه>"
```

## ۲. ثبت Secretها

```bash
wrangler secret put BALE_TOKEN        # توکن واقعی ربات: 1625635207:AbCd...
wrangler secret put TIMERY_KEYS       # کلید ساختگی: TIMERY-A1B2C3,TIMERY-D4E5F6
wrangler secret put WEBHOOK_SECRET    # یک رشتهٔ تصادفی (رمز مسیر webhook)
```

## ۳. انتشار

```bash
wrangler deploy
```

## ۴. ثبت webhook (یک‌بار)

بدون این مرحله، سرور هیچ‌وقت نمی‌فهمد کاربر `/start` زده:

```bash
curl -X POST "https://timery-bale-relay.XXX.workers.dev/admin/webhook" \
  -H "Content-Type: application/json" \
  -H "x-timery-key: TIMERY-A1B2C3" \
  -d '{}'
```

پاسخ باید `{"ok":true,...}` باشد. برای بررسی:

```bash
curl "https://timery-bale-relay.XXX.workers.dev/health"
# "webhookConfigured": true
```

> ⚠️ وقتی webhook فعال است، `getUpdates` کار نمی‌کند (خطای 409).
> این طبیعی است — دیگر لازمش نداریم.
> برای برگشت به حالت polling: `-d '{"delete":true}'`

## ۵. وارد کردن در افزونه

```js
// js/config.js
var TIMERY_CONFIG = {
  baleKey: 'TIMERY-A1B2C3',
  proxyUrl: 'https://timery-bale-relay.XXX.workers.dev',
  botUsername: '@timery_bot',
  ...
};
```

**تمام.** کاربر فقط روی «ساخت کد اتصال» می‌زند و لینک را در بله باز می‌کند.

---

## مسیرهای API

| متد | مسیر | احراز هویت | کار |
|---|---|---|---|
| GET | `/health` | — | وضعیت سرویس + وضعیت webhook |
| POST | `/bale/hook?k=SECRET` | `WEBHOOK_SECRET` | دریافت آپدیت‌های بله |
| GET | `/bot` | `x-timery-key` | نام و یوزرنیم ربات |
| POST | `/pair/start` | `x-timery-key` | ساخت کد اتصال |
| GET | `/pair/check?code=X` | `x-timery-key` | آیا کد تأیید شد؟ |
| GET | `/status?username=X` | `x-timery-key` | آیا کاربر وصل است؟ |
| POST | `/send` | `x-timery-key` | `{username, chatId, text}` |
| GET | `/commands?username=X` | `x-timery-key` | فرمان‌های ارسالی کاربر |
| POST | `/admin/webhook` | `x-timery-key` | ثبت/حذف webhook |
| GET | `/debug` | `x-timery-key` | نگاشت کاربران + وضعیت webhook |

کلید می‌تواند در هدر `x-timery-key` یا پارامتر `?key=` باشد
(پارامتر برای درخواست‌های بدون preflight لازم است).

### نمونهٔ تست

```bash
# ۱) کد بگیر
curl -X POST "https://.../pair/start" -H "x-timery-key: TIMERY-A1B2C3" -d '{}'
# → {"ok":true,"code":"AB12CD","deepLink":"https://ble.ir/timery_bot?start=AB12CD"}

# ۲) لینک را در بله باز کنید، بعد بررسی کنید
curl "https://.../pair/check?code=AB12CD&key=TIMERY-A1B2C3"
# → {"ok":true,"linked":true,"chatId":"111","username":"ali"}

# ۳) ارسال
curl -X POST "https://.../send" -H "x-timery-key: TIMERY-A1B2C3" \
  -H "Content-Type: application/json" \
  -d '{"username":"ali","text":"سلام 👋"}'
# → {"ok":true,"chatId":"111"}
```

اگر کاربر وصل نباشد:

```json
{ "ok": false, "error": "not_linked", "needsPairing": true }
```

---

## عیب‌یابی

| نشانه | علت | راه‌حل |
|---|---|---|
| `not_linked` (409) | کاربر هنوز `/start` نزده | از دکمهٔ «ساخت کد اتصال» استفاده کند |
| `webhookConfigured: false` | webhook ثبت نشده | `/admin/webhook` را صدا بزنید |
| `kvConfigured: false` | KV بایند نشده | مرحلهٔ ۱ + `wrangler deploy` دوباره |
| `unauthorized` | کلید اشتباه | `TIMERY_KEYS` و `js/config.js` را هم‌سان کنید |
| کد منقضی می‌شود | بیش از ۱۵ دقیقه گذشته | کد تازه بگیرید |
| `Bad Request: can't parse entities` | Markdown خراب | خودکار با متن ساده دوباره تلاش می‌شود |

---

## 🔐 نکات امنیتی

- توکن واقعی فقط در Secret کلودفلر است ✅
- کلید ساختگی بدون سرور بی‌ارزش است ✅
- توکن واقعی به‌عنوان کلید مجاز پذیرفته **نمی‌شود** (تست‌شده) ✅
- کد اتصال یک‌بارمصرف است و به چت دوم داده نمی‌شود ✅
- webhook با رمز مسیر محافظت می‌شود (بدون رمز → 403) ✅
- محدودیت نرخ: ۱۲۰ پیام در ساعت برای هر چت

---

## تست خودکار

```bash
node tests/worker-test.js
```

۳۳ بررسی: احراز هویت، رد شدن ارسال قبل از اتصال، جریان کامل کد، ارسال با `chat_id` عددی،
fallback متن ساده، صف فرمان‌ها و امنیت کد تکراری.
