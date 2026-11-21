# مراحل راه‌اندازی — چک‌لیست

## ✅ سرور کامل آماده است (۲۷ مهر ۱۴۰۵)

```json
{
  "version": 5,
  "tokenConfigured": true,
  "keyConfigured": true,
  "kvConfigured": true,
  "webhookConfigured": true,
  "bot": { "username": "timery_bot" }
}
```

آدرس Worker فعال:

```
https://timery-bale-relay.id6108179.workers.dev
```

تنها کارِ باقی‌مانده سمت افزونه است → بخش «۸) افزونه».

---

## ⚠️ دو حساب Cloudflare

Worker قدیمی روی حساب `hkhoramir` بود، ولی wrangler با حساب `id6108179` لاگین است.
Worker جدید در حساب `id6108179` منتشر شد و `js/config.js` به آدرس آن تغییر کرد.

| مورد | وضعیت |
|---|---|
| نصب wrangler | ✅ 4.153.0 |
| لاگین Cloudflare | ✅ id6108179@gmail.com |
| KV (CHATS) | ✅ `2bc281a20c2042bca6348843b468efb4` |
| کد v5 | ✅ منتشر شد |
| `TIMERY_KEYS` | ✅ `TIMERY-A1B2C3` |
| `BALE_TOKEN` | ✅ ثبت شد |
| `BOT_USERNAME` | ✅ `timery_bot` (تأییدشده با getMe) |
| webhook | ✅ ثبت شد |
| افزونه | ⏳ Reload + ساخت کد اتصال |

---

## مراحل انجام‌شده (برای مرجع)

### ۱) شناسهٔ KV

```bash
cd worker
wrangler kv namespace list
```

خروجی:

```json
[{ "id": "2bc281a20c2042bca6348843b468efb4", "title": "adam" }]
```

این شناسه در `worker/wrangler.toml` ثبت شد.

> اگر خروجی خالی بود: `wrangler kv namespace create CHATS`

---

## ۲) کلید یکسان با افزونه

```bash
wrangler secret put TIMERY_KEYS
# وقتی پرسید، این را بنویس:  TIMERY-A1B2C3
```

این مقدار **باید** با `baleKey` در `js/config.js` مو‌به‌مو یکی باشد.

---

## ۳) رمز مسیر webhook

```bash
wrangler secret put WEBHOOK_SECRET
# یک رشتهٔ تصادفی، مثلاً: hk-9f3a7c21
```

---

## ۴) نام ربات

در `worker/wrangler.toml`:

```toml
[vars]
BOT_USERNAME = "timery_bot"   # ← یوزرنیم واقعی رباتت، بدون @
```

---

## ۵) انتشار

```bash
wrangler deploy
```

---

## ۶) ثبت webhook (فقط یک‌بار)

**PowerShell:**

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://timery-bale-relay.id6108179.workers.dev/admin/webhook" `
  -Headers @{ "x-timery-key" = "TIMERY-A1B2C3" } `
  -ContentType "application/json" -Body "{}"
```

**bash / Git Bash:**

```bash
curl -X POST "https://timery-bale-relay.id6108179.workers.dev/admin/webhook" \
  -H "x-timery-key: TIMERY-A1B2C3" \
  -H "Content-Type: application/json" \
  -d '{}'
```

پاسخ باید `ok : True` باشد.

---

## ۷) بررسی نهایی

```bash
curl "https://timery-bale-relay.id6108179.workers.dev/health"
```

باید ببینی:

```json
{
  "version": 5,
  "kvConfigured": true,
  "webhookConfigured": true,
  "bot": { "username": "timery_bot" }
}
```

اگر `version` عدد ۵ نبود، deploy انجام نشده. اگر `webhookConfigured: false` بود، مرحلهٔ ۶ رد شده.

---

## ۸) افزونه

1. `chrome://extensions`
2. روی Timery → آیکن 🔄 (Reload)
3. افزونه را باز کن → تب **تنظیمات** → **بات بله**
4. دکمهٔ **«🔗 ساخت کد اتصال»**
5. کد ۶ رقمی نمایش داده می‌شود → **«باز کردن بله»**
6. در بله دکمهٔ **Start** را بزن
7. ربات پیام «✅ اتصال با موفقیت انجام شد» می‌دهد
8. به افزونه برگرد — وضعیت باید **«متصل ✓»** شود

---

## ۹) تست

از افزونه یک تایمر ۱ دقیقه‌ای بگذار → باید در بله پیام بیاید.  
و برعکس: در بله بنویس `/status` → باید وضعیت مرورگر را جواب بدهد.

---

## اگر گیر کردی

| خطا                        | معنی                | راه‌حل                    |
| -------------------------- | ------------------- | ------------------------- |
| `unauthorized / mismatch`  | کلیدها یکی نیستند   | مرحلهٔ ۲ + `js/config.js` |
| `not_linked` (409)         | کاربر `/start` نزده | مرحلهٔ ۸                  |
| `webhookConfigured: false` | webhook ثبت نشده    | مرحلهٔ ۶                  |
| `kvConfigured: false`      | KV بایند نیست       | مرحلهٔ ۱                  |
| `version` قدیمی            | deploy نشده         | مرحلهٔ ۵                  |
| کد «منقضی»                 | ۱۵ دقیقه گذشته      | کد تازه بگیر              |

---

## 🚨 خطای `ERR_CONNECTION_CLOSED` / `TypeError` / `AbortError` در افزونه

**نکته:** تنظیم «Use secure DNS» و فایل `hosts` هر دو بیربط/غیرضروری‌اند.
راه‌حل واقعی در خود افزونه پیاده شده است.

### علت واقعی (تست‌شده)

در این شبکه، پورت **۴۴۳** برای دامنه‌های `*.workers.dev` به‌صورت تصادفی reset می‌شود
(`ERR_CONNECTION_RESET`)، ولی پورت‌های جایگزین Cloudflare باز هستند:

| پورت | نتیجه در Chrome |
|---|---|
| 443 | ❌ ناپایدار (۰ تا ۵۰٪) |
| 2053 | ✅ ~۵۰٪ — و با تلاش مجدد تقریباً همیشه |
| 2087 | ✅ ~۲۵–۵۰٪ |
| 2083 / 2096 / 8443 | ❌ |
| 80 / 8080 / 8880 / 2052 | ❌ |

همچنین `pages.dev` هم بلاک است، ولی `vercel.app` و `cloudflare.com` سالم‌اند.

### ✅ راه‌حل پیاده‌شده

افزونه حالا خودش بین پورت‌ها می‌چرخد و اولین موفق را به خاطر می‌سپارد:

```js
// js/config.js
proxyFallbackPorts: [2053, 2087, 443],
```

`callWorker()` در `service_worker.js` هر پورت را دو دور امتحان می‌کند
(۶ تلاش) و `stickyBase` را برای درخواست‌های بعدی ذخیره می‌کند.

**کاری که کاربر باید بکند:** فقط افزونه را Reload کند. تمام.

### اگر باز هم نشد

یعنی کل شبکه به Cloudflare دسترسی ندارد. در آن صورت بهترین راه، انتقال
relay به دامنه‌ای است که باز باشد (مثلاً یک پروژهٔ Vercel که فقط درخواست‌ها را
به همین Worker فوروارد کند — بدون نیاز به تغییر منطق اپلیکیشن).

---

