/**
 * گرفتن اسکرین‌شات از پنل‌های مختلف با Chrome headless
 * اجرا: node tests/shots.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, '..', 'shots');
const BASE = 'http://localhost:8765/tests/preview.html';

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const targets = [
  { name: 'timer', hash: 'timer' },
  { name: 'stopwatch', hash: 'stopwatch' },
  { name: 'reminders', hash: 'reminders' },
  { name: 'tools', hash: 'tools' },
  { name: 'settings', hash: 'settings' },
  { name: 'about', hash: 'about' },
  { name: 'dark-timer', hash: 'timer', query: 'theme=dark' },
  { name: 'dark-settings', hash: 'settings', query: 'theme=dark' },
  { name: 'modal-age', hash: 'tools', query: 'demo=age' }
];

for (const t of targets) {
  const file = path.join(OUT, t.name + '.png');
  const url = `${BASE}${t.query ? '?' + t.query : ''}#${t.hash}`;
  try {
    execFileSync(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--virtual-time-budget=2500',
      '--window-size=520,680',
      `--screenshot=${file}`,
      url
    ], { stdio: 'ignore', timeout: 30000 });
    console.log('✓ ' + t.name + ' → ' + file);
  } catch (e) {
    console.log('✗ ' + t.name + ': ' + e.message);
  }
}
