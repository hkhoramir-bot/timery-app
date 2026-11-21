/**
 * تست‌های واحد — با: node tests/run.js
 * تاریخ شمسی، مدت زمان و منطق زمان‌بندی یادآورها را بررسی می‌کند.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function loadScript(file, context) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  vm.createContext(context);
  vm.runInContext(code, context, { filename: file });
  return context;
}

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label} → expected: ${expected}, got: ${actual}`);
  }
}

function assertTrue(value, label) {
  assertEqual(Boolean(value), true, label);
}

// ==================== تاریخ شمسی ====================
console.log('\n📅 تبدیل تاریخ شمسی');
const ctx = { console, Math, Date, String, Number, Array, Object, isFinite, parseInt, RegExp, JSON };
ctx.self = ctx;
loadScript('js/jalali.js', ctx);
const Jalali = ctx.Jalali;

assertEqual(Jalali.toGregorian(1403, 1, 1).gy, 2024, '1403/01/01 → 2024');
assertEqual(Jalali.toGregorian(1403, 1, 1).gm, 3, '1403/01/01 → ماه 3');
assertEqual(Jalali.toGregorian(1403, 1, 1).gd, 20, '1403/01/01 → روز 20');
assertEqual(Jalali.toGregorian(1403, 12, 30).gd, 20, '1403/12/30 → 2025/03/20 (سال کبیسه)');
assertEqual(Jalali.toGregorian(1403, 12, 29).gd, 19, '1403/12/29 → 2025/03/19');
assertEqual(Jalali.toGregorian(1404, 1, 1).gm, 3, '1404/01/01 → 2025/03/21 (نوروز ۱۴۰۴)');
assertEqual(Jalali.toGregorian(1400, 1, 1).gd, 21, '1400/01/01 → 2021/03/21');
assertEqual(Jalali.toGregorian(1350, 1, 1).gd, 21, '1350/01/01 → 1971/03/21');

const j = Jalali.toJalali(2025, 3, 20);
assertEqual(j.jy, 1403, '2025/03/20 → 1403');
assertEqual(j.jm, 12, '2025/03/20 → ماه 12');
assertEqual(j.jd, 30, '2025/03/20 → روز 30');

assertTrue(Jalali.isLeapJalaaliYear(1403), '1403 سال کبیسه است');
assertTrue(!Jalali.isLeapJalaaliYear(1404), '1404 سال کبیسه نیست');
assertEqual(Jalali.jalaaliMonthLength(1403, 12), 30, 'اسفند ۱۴۰۳ = ۳۰ روز');
assertEqual(Jalali.jalaaliMonthLength(1404, 12), 29, 'اسفند ۱۴۰۴ = ۲۹ روز');

assertEqual(Jalali.parse('1403/01/15').jy, 1403, 'parse با اعداد لاتین');
assertEqual(Jalali.parse('۱۴۰۳/۰۱/۱۵').jy, 1403, 'parse با اعداد فارسی');
assertEqual(Jalali.parse('۱۴۰۳-۰۱-۱۵').jd, 15, 'parse با خط تیره');
assertEqual(Jalali.parse('1403/13/01'), null, 'parse ماه نامعتبر → null');
assertEqual(Jalali.parse('1403/12/30') !== null, true, 'parse اسفند ۳۰ کبیسه');
assertEqual(Jalali.parse('1404/12/30'), null, 'parse اسفند ۳۰ غیرکبیسه → null');

// رفت‌وبرگشت برای ۲۰ سال
let roundTripOk = true;
for (let year = 1395; year <= 1415; year++) {
  for (let month = 1; month <= 12; month++) {
    const maxDay = Jalali.jalaaliMonthLength(year, month);
    for (const day of [1, 15, maxDay]) {
      const g = Jalali.toGregorian(year, month, day);
      const back = Jalali.toJalali(g.gy, g.gm, g.gd);
      if (back.jy !== year || back.jm !== month || back.jd !== day) {
        roundTripOk = false;
        console.log(`    mismatch: ${year}/${month}/${day} → ${g.gy}/${g.gm}/${g.gd} → ${back.jy}/${back.jm}/${back.jd}`);
      }
    }
  }
}
assertTrue(roundTripOk, 'رفت‌وبرگشت ۱۴۰۰ تا ۱۴۱۰ بدون خطا');

// ==================== مدت زمان ====================
console.log('\n⏱ تحلیل مدت زمان');
const popupCtx = { console, Math, Date, String, Number, Array, Object, isFinite, parseInt, RegExp, JSON, setInterval: () => {}, setTimeout: () => {}, clearInterval: () => {}, requestAnimationFrame: () => {} };
popupCtx.self = popupCtx;
popupCtx.window = popupCtx;
popupCtx.chrome = { runtime: { getManifest: () => ({ version: '3.1.0' }), sendMessage: async () => ({ success: true }), onMessage: { addListener: () => {} } }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } } };
popupCtx.document = {
  addEventListener: () => {},
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add: () => {}, toggle: () => {}, remove: () => {} }, appendChild: () => {}, addEventListener: () => {}, dataset: {}, textContent: '' })
};
loadScript('js/jalali.js', popupCtx);
loadScript('js/utils.js', popupCtx);
loadScript('popup.js', popupCtx);

// تابع parseDuration داخل II است؛ برای تست، همان منطق را جداگانه می‌سنجیم
const parseSrc = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const match = parseSrc.match(/function parseDuration\(raw\)[\s\S]*?\n  }/);
const testCtx = {
  Math, String, parseFloat, console,
  toLatinDigits: (str) => String(str)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
};
vm.createContext(testCtx);
vm.runInContext(match[0] + '\nthis.parseDuration = parseDuration;', testCtx);
const parseDuration = testCtx.parseDuration;

assertEqual(parseDuration('25'), 1500, '«25» → ۲۵ دقیقه');
assertEqual(parseDuration('۲۵ دقیقه'), 1500, '«۲۵ دقیقه»');
assertEqual(parseDuration('25 دقیقه'), 1500, '«25 دقیقه»');
assertEqual(parseDuration('1:30'), 90, '«1:30» → ۹۰ ثانیه');
assertEqual(parseDuration('2 ساعت'), 7200, '«2 ساعت»');
assertEqual(parseDuration('1h'), 3600, '«1h»');
assertEqual(parseDuration('2h 15m'), 8100, '«2h 15m»');
assertEqual(parseDuration('45 ثانیه'), 45, '«45 ثانیه»');
assertEqual(parseDuration('90s'), 90, '«90s»');
assertEqual(parseDuration('10m'), 600, '«10m»');
assertEqual(parseDuration('نامعتبر'), null, 'ورودی نامعتبر → null');
assertEqual(parseDuration(''), null, 'ورودی خالی → null');
assertEqual(parseDuration('1:75'), null, 'ثانیهٔ نامعتبر → null');

// ==================== زمان‌بندی یادآورها ====================
console.log('\n🔔 زمان‌بندی یادآورها');
const swSrc = fs.readFileSync(path.join(root, 'service_worker.js'), 'utf8');
const swMatch = swSrc.match(/function computeNextTrigger\(reminder, from\)[\s\S]*?\n}/);
const swCtx = { Math, Date, String, Number, Array, Object, console };
swCtx.daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
vm.createContext(swCtx);
vm.runInContext(swMatch[0] + '\nthis.computeNextTrigger = computeNextTrigger;', swCtx);
const computeNextTrigger = swCtx.computeNextTrigger;

const now = new Date(2026, 9, 21, 12, 0, 0); // 21 اکتبر 2026 — چهارشنبه

const daily = computeNextTrigger({ time: '09:00', repeat: 'daily' }, now.getTime());
assertEqual(new Date(daily).getHours(), 9, 'روزانه: ساعت ۹');
assertEqual(new Date(daily).getDate(), 22, 'روزانه: فردا (چون امروز گذشته)');

const dailyLater = computeNextTrigger({ time: '23:30', repeat: 'daily' }, now.getTime());
assertEqual(new Date(dailyLater).getDate(), 21, 'روزانه: همان روز اگر هنوز نگذشته باشد');
assertEqual(new Date(dailyLater).getHours(), 23, 'روزانه: ساعت ۲۳:۳۰');

const once = computeNextTrigger({ time: '08:00', repeat: 'once', date: '2026-10-25' }, now.getTime());
assertEqual(new Date(once).getDate(), 25, 'یک‌بار: تاریخ مشخص');
assertEqual(new Date(once).getHours(), 8, 'یک‌بار: ساعت مشخص');

const oncePast = computeNextTrigger({ time: '08:00', repeat: 'once', date: '2026-10-01' }, now.getTime());
assertEqual(oncePast, null, 'یک‌بار در گذشته → null');

const weekly = computeNextTrigger({ time: '10:00', repeat: 'weekly', days: [0] }, now.getTime());
assertEqual(new Date(weekly).getDay(), 6, 'هفتگی شنبه (۰ = شنبه در تقویم فارسی)');

const monthly = computeNextTrigger({ time: '10:00', repeat: 'monthly' }, now.getTime());
assertEqual(new Date(monthly).getDate(), 21, 'ماهانه: همان روز ماه');

const yearly = computeNextTrigger({ time: '10:00', repeat: 'yearly' }, now.getTime());
assertEqual(new Date(yearly).getFullYear(), 2027, 'سالانه: سال بعد');

// ==================== فرمان‌های بله ====================
console.log('\n🤖 تحلیل فرمان‌های بله');
const cmdCtx = { Math, Date, String, Number, Array, Object, console };
vm.createContext(cmdCtx);
const swSrc2 = fs.readFileSync(path.join(root, 'service_worker.js'), 'utf8');
const durMatch = swSrc2.match(/function parseDurationArg\(text\)[\s\S]*?\n}/);
vm.runInContext(durMatch[0] + '\nthis.parseDurationArg = parseDurationArg;', cmdCtx);
const parseDurationArg = cmdCtx.parseDurationArg;

assertEqual(parseDurationArg('10m'), 600, 'فرمان «10m» → ۶۰۰ ثانیه');
assertEqual(parseDurationArg('10 دقیقه'), 600, 'فرمان «10 دقیقه»');
assertEqual(parseDurationArg('25'), 1500, 'فرمان «25» → ۲۵ دقیقه');
assertEqual(parseDurationArg('1:30'), 90, 'فرمان «1:30»');
assertEqual(parseDurationArg('2h'), 7200, 'فرمان «2h»');
assertEqual(parseDurationArg('نامعتبر'), null, 'فرمان نامعتبر → null');
assertEqual(parseDurationArg(''), null, 'فرمان خالی → null');

// ==================== نتیجه ====================
console.log(`\n${failed === 0 ? '✅' : '❌'} نتیجه: ${passed} موفق، ${failed} ناموفق\n`);
process.exit(failed === 0 ? 0 : 1);
