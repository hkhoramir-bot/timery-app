/**
 * js/bale-messages.js
 * ------------------------------------------------------------------
 * قالب‌بندی پیام‌های بله — همهٔ پیام‌های افزونه از این عبور می‌کنند
 * تا ظاهر یکدست و حرفه‌ای داشته باشند.
 *
 * نکته: بله Markdown محدودی دارد، پس از نشانه‌های ساده (*bold*)
 * و کاراکترهای گرافیکی (─ ▸ • ✨) استفاده می‌کنیم که همیشه درست نمایش داده می‌شوند.
 */
(function (global) {
  'use strict';

  const LINE = '━━━━━━━━━━━━━━━';
  const THIN = '───────────────────';

  const fa = (v) => String(v).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
  const pad = (n) => String(n).padStart(2, '0');

  function clock(seconds) {
    const t = Math.max(0, Math.floor(seconds));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const text = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    return fa(text);
  }

  /** ساخت یک «کارت» متنی */
  function card(title, rows, footer) {
    const body = (rows || [])
      .filter(Boolean)
      .map((r) => `${r.icon}  ${r.label} ▸ ${r.value}`)
      .join('\n');

    return [
      `⏱  *${title}*`,
      LINE,
      body,
      LINE,
      footer || ''
    ].filter((x) => x !== '').join('\n');
  }

  const BaleMessages = {
    fa,
    clock,
    LINE,
    THIN,

    /** یادآور */
    reminder(reminder, nextLabel) {
      const rows = [
        { icon: '🕒', label: 'ساعت', value: fa(reminder.time) },
        { icon: '📝', label: 'متن', value: reminder.text }
      ];
      if (reminder.repeatLabel) rows.push({ icon: '🔁', label: 'تکرار', value: reminder.repeatLabel });
      if (nextLabel) rows.push({ icon: '⏭', label: 'بعدی', value: nextLabel });

      return card('یادآور', rows,
        '💡 برای کنترل مرورگر: /timer 10m · /list · /stop · /status');
    },

    /** پیام تست */
    test() {
      const now = new Date();
      return card('پیام تست ارسال شد ✅', [
        { icon: '✅', label: 'وضعیت', value: 'ارتباط برقرار است' },
        { icon: '🕒', label: 'زمان', value: `${fa(pad(now.getHours()))}:${fa(pad(now.getMinutes()))}` }
      ], 'این پیام را تایمرهای شما می‌فرستند.');
    },

    /** تایمر از راه بله شروع شد */
    timerStarted(seconds) {
      return card('تایمر شروع شد ⏳', [
        { icon: '⏳', label: 'مدت', value: clock(seconds) }
      ], 'با /stop می‌توانید متوقفش کنید.');
    },

    /** فهرست تایمرها */
    timerList(timers) {
      if (!timers.length) {
        return card('تایمرهای فعال', [
          { icon: '🕒', label: 'وضعیت', value: 'هیچ تایمر فعالی وجود ندارد' }
        ]);
      }
      const rows = timers.map((t) => `${'•'}  ${t.title} ▸ ${clock(t.remaining)}`);
      return [
        '⏱  *تایمرهای فعال*',
        LINE,
        rows.join('\n'),
        LINE,
        `🕒 مجموع: ${fa(timers.length)} تایمر`
      ].join('\n');
    },

    /** وضعیت کلی */
    status(ctx) {
      return card('وضعیت Timery 📊', [
        { icon: '⏱', label: 'تایمرها', value: fa(ctx.timers || 0) },
        { icon: '🔔', label: 'یادآورها', value: fa(ctx.reminders || 0) },
        { icon: '🍅', label: 'پومودورو', value: fa(ctx.pomodoros || 0) },
        { icon: '🛡', label: 'تمرکز', value: ctx.focusEnabled ? 'فعال' : 'خاموش' },
        { icon: '⏳', label: 'دقیقهٔ تمرکز', value: fa(ctx.focusMinutes || 0) }
      ]);
    },

    /** همه متوقف شدند */
    stopped() {
      return [
        '🛑  *تایمرها متوقف شدند*',
        LINE,
        'همهٔ تایمرهای فعال حذف شدند.',
        'برای شروع دوباره: /timer 10m'
      ].join('\n');
    },

    /** یادآور ساخته شد */
    reminderCreated(time, text) {
      return card('یادآور ثبت شد ✅', [
        { icon: '🕒', label: 'ساعت', value: fa(time) },
        { icon: '📝', label: 'متن', value: text }
      ]);
    },

    /** پایان حالت تمرکز */
    focusEnded() {
      return [
        '🔓  *حالت تمرکز پایان یافت*',
        LINE,
        'سایت‌های مسدودشده دوباره در دسترس هستند.',
        'آفرین! 💪'
      ].join('\n');
    },

    /** پایان جلسهٔ پومودورو */
    pomodoroDone(sessions) {
      return card('جلسهٔ تمرکز تمام شد 🍅', [
        { icon: '🍅', label: 'جلسات امروز', value: fa(sessions) },
        { icon: '☕', label: 'قدم بعدی', value: 'استراحت کوتاه' }
      ], 'برای شروع دوباره: /timer 25m');
    },

    /** خطا */
    error(text, hint) {
      return [
        '⚠️  *خطا*',
        LINE,
        `❌ ${text}`,
        hint ? `💡 ${hint}` : ''
      ].filter(Boolean).join('\n');
    },

    /** پیام معرفی ربات (وقتی کاربر «تست اتصال» می‌زند) */
    ping(botUsername) {
      const who = botUsername ? ` (${botUsername})` : '';
      return [
        `👋  *سلام! من ربات Timery هستم*${who}`,
        '━━━━━━━━━━━━━━━',
        '✅ *اتصال برقرار است*',
        'این پیام مستقیماً از ربات برای شما ارسال شده؛',
        'یعنی یادآورها و تایمرهایتان را در بله دریافت می‌کنید.',
        '━━━━━━━━━━━━━━━',
        '⏱  /timer 10m ▸ شروع تایمر',
        '📋  /list ▸ لیست تایمرها',
        '🛑  /stop ▸ توقف همه',
        '📊  /status ▸ وضعیت کامل',
        '🔔  /remind 9:00 متن ▸ ساخت یادآور',
        '━━━━━━━━━━━━━━━',
        'همین‌جا فرمان بفرستید ✨'
      ].join('\n');
    },

    /** راهنمای فرمان‌ها */
    help() {
      return [
        '🤖  *فرمان‌های Timery*',
        LINE,
        '⏱  /timer 10m ▸ شروع تایمر (۲۵ دقیقه، 1:30 هم می‌پذیرد)',
        '📋  /list ▸ لیست تایمرهای فعال',
        '🛑  /stop ▸ توقف همهٔ تایمرها',
        '📊  /status ▸ وضعیت کامل',
        '🔔  /remind 9:00 متن ▸ ساخت یادآور روزانه',
        LINE,
        'مثال: /timer 25m'
      ].join('\n');
    },

    /** پیام خوش‌آمدگویی (اولین ارتباط) */
    welcome() {
      return [
        '👋  *به Timery خوش آمدید!*',
        LINE,
        'من تایمر، یادآور و پومودوروی مرورگر شما هستم.',
        'با فرمان‌های زیر، مرورگرتان را از همین‌جا کنترل کنید:',
        '',
        '⏱  /timer 10m ▸ شروع تایمر',
        '📋  /list ▸ لیست تایمرها',
        '🛑  /stop ▸ توقف همه',
        '📊  /status ▸ وضعیت کامل',
        '🔔  /remind 9:00 متن ▸ ساخت یادآور',
        LINE,
        'مثال: /timer 25m'
      ].join('\n');
    }
  };

  if (typeof self !== 'undefined') self.BaleMessages = BaleMessages;
  if (typeof window !== 'undefined') window.BaleMessages = BaleMessages;
})(typeof self !== 'undefined' ? self : this);
