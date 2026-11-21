/**
 * پیش‌نمایش پیام‌های بله — اجرا: node tests/preview-messages.js
 * خروجی در کنسول چاپ می‌شود.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { console, Math, Date, String, Number, Array, Object, JSON, isFinite, parseInt };
ctx.self = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'bale-messages.js'), 'utf8'), ctx, { filename: 'bale-messages.js' });

const M = ctx.BaleMessages;

function show(title, text) {
  console.log('\n' + '━'.repeat(62));
  console.log('  ' + title);
  console.log('━'.repeat(62));
  console.log(text);
}

show('یادآور', M.reminder(
  { time: '09:00', text: 'پرداخت قبض برق', repeatLabel: 'روزانه' },
  'فردا ۰۹:۰۰'
));

show('پیام تست', M.test());

show('تایمر شروع شد', M.timerStarted(1500));

show('فهرست تایمرها', M.timerList([
  { title: 'چای', remaining: 211 },
  { title: 'پومودورو', remaining: 940 }
]));

show('وضعیت', M.status({
  timers: 2, reminders: 3, pomodoros: 4, focusEnabled: true, focusMinutes: 100
}));

show('توقف', M.stopped());

show('یادآور ساخته شد', M.reminderCreated('09:00', 'پرداخت قبض'));

show('پایان تمرکز', M.focusEnded());

show('پایان پومودورو', M.pomodoroDone(4));

show('خطا', M.error('قالب زمان نامعتبر است.', 'مثال: /timer 10m یا /timer 25 دقیقه'));

show('راهنما', M.help());

show('خوش‌آمدگویی', M.welcome());
