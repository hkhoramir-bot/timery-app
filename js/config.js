/**
 * js/config.js
 * ------------------------------------------------------------------
 * ⭐ تنظیمات توسعه‌دهنده — کاربر نهایی هیچ‌چیز اینجا را نمی‌بیند.
 *    او فقط روی «ساخت کد اتصال» می‌زند و لینک را در بله باز می‌کند.
 *
 * 🔐 معماری «توکن پشت توکن»:
 *   • اینجا فقط یک «کلید ساختگی» (handle) قرار می‌گیرد — مثلاً TIMERY-A1B2C3
 *   • توکن واقعی ربات بله روی سرور (Cloudflare Worker) و به‌صورت Secret می‌ماند
 *   • بدون سرور، این کلید ساختگی هیچ ارزشی ندارد
 *
 * 📌 مراحل (یک‌بار برای همیشه):
 *   ۱) KV بسازید (الزامی — نگاشت یوزرنیم → chat_id):
 *        cd worker && wrangler kv namespace create CHATS
 *        شناسه را در worker/wrangler.toml بگذارید
 *   ۲) Worker را منتشر کنید:  wrangler deploy
 *   ۳) توکن واقعی ربات را سِکرت کنید:
 *        wrangler secret put BALE_TOKEN
 *   ۴) کلید ساختگی را ثبت کنید (می‌توانید چند کلید داشته باشید):
 *        wrangler secret put TIMERY_KEYS      ← مقدار: TIMERY-A1B2C3,TIMERY-D4E5F6
 *   ۵) رمز مسیر webhook:
 *        wrangler secret put WEBHOOK_SECRET
 *   ۶) webhook را ثبت کنید (بدون این، سرور /start کاربر را نمی‌بیند):
 *        curl -X POST "https://<worker>/admin/webhook" \
 *          -H "x-timery-key: TIMERY-A1B2C3" -d '{}'
 *   ۷) همین کلید ساختگی را در `baleKey` پایین بگذارید
 *
 * ⚠️ چرا کد اتصال؟ بله/تلگرام اجازه نمی‌دهند ربات با @username به چت خصوصی
 *    پیام بدهد. ربات فقط بعد از /start کاربر، chat_id عددی را می‌گیرد.
 */
var TIMERY_CONFIG = {
  // ⭐ کلید ساختگی (نه توکن واقعی!) — همان که در TIMERY_KEYS ثبت کرده‌اید
  baleKey: 'TIMERY-A1B2C3',

  // آدرس Cloudflare Worker (واسط)
  proxyUrl: 'https://timery-bale-relay.id6108179.workers.dev',

  // 🔁 پورت‌های جایگزین Cloudflare — به ترتیب امتحان می‌شوند
  //
  // چرا؟ در بعضی شبکه‌ها پورت ۴۴۳ برای دامنه‌های Cloudflare به‌صورت
  // تصادفی reset می‌شود (فیلترینگ)، ولی ۲۰۵۳ و ۲۰۸۷ باز هستند.
  // افزونه هر سه را امتحان می‌کند و اولین موفق را به خاطر می‌سپارد.
  proxyFallbackPorts: [2053, 2087, 443],

  // ⛔️⛔️ هرگز توکن بات بله را در این فایل نگذارید ⛔️⛔️
  //     این فایل داخل بستهٔ افزونه منتشر می‌شود و هر کسی می‌تواند بخواندش.
  //     توکن فقط با «wrangler secret put BALE_TOKEN» روی Cloudflare ذخیره می‌شود.
  //     این گزینه فقط برای تست محلی است و به‌صورت پیش‌فرض خاموش است؛
  //     حتی اگر baleToken را اینجا بنویسید، تا این true نشود نادیده گرفته می‌شود.
  allowDirectToken: false,

  // یوزرنیم ربات (برای نمایش به کاربر)
  botUsername: '@timery_bot',

  // هر چند دقیقه فرمان‌های ارسالی از بله بررسی شود (حداقل ۱)
  pollIntervalMinutes: 1,

  // آدرس مخزن برای گزارش مشکل و پیشنهاد قابلیت
  repoUrl: 'https://github.com/hkhoramir/timery'
};

if (typeof window !== 'undefined') window.TIMERY_CONFIG = TIMERY_CONFIG;
if (typeof self !== 'undefined') self.TIMERY_CONFIG = TIMERY_CONFIG;
