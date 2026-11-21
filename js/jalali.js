/**
 * js/jalali.js
 * ------------------------------------------------------------------
 * تبدیل تاریخ شمسی ⇄ میلادی با الگوریتم JDN (برگرفته از jalaali-js).
 * دقت: برای همهٔ سال‌های معتبر از ۱۲۷۸ شمسی تا ۳۱۷۷ شمسی صحیح است.
 *
 * API:
 *   Jalali.toJalali(gy, gm, gd) -> {jy, jm, jd}
 *   Jalali.toGregorian(jy, jm, jd) -> {gy, gm, gd}
 *   Jalali.isLeapJalaaliYear(jy) -> boolean
 *   Jalali.isValidJalali(jy, jm, jd) -> boolean
 *   Jalali.formatJalali(jy, jm, jd) -> "۱۴۰۳/۰۱/۱۵"
 *   Jalali.parse(str) -> {jy, jm, jd} | null
 */
(function (global) {
  'use strict';

  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  function jalCal(jy, withoutLeap) {
    var breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    var bl = breaks.length;
    var gy = jy + 621;
    var leapJ = -14;
    var jp = breaks[0];
    var jm, jump, leap, leapG, march, n, i;

    if (jy < jp || jy >= breaks[bl - 1]) return null;

    for (i = 1; i < bl; i += 1) {
      jm = breaks[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;

    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;

    if (!withoutLeap) {
      if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
      leap = mod(mod(n + 1, 33) - 1, 4);
      if (leap === -1) leap = 4;
    }

    return { leap: leap, gy: gy, march: march };
  }

  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
      div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function d2g(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div(mod(j, 1461), 4) * 5 + 308;
    var gd = div(mod(i, 153), 5) + 1;
    var gm = mod(div(i, 153), 12) + 1;
    var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  function j2d(jy, jm, jd) {
    var r = jalCal(jy, true);
    if (!r) return null;
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function d2j(jdn) {
    var gy = d2g(jdn).gy;
    var jy = gy - 621;
    var r = jalCal(jy, false);
    var jdn1f = g2d(gy, 3, r.march);
    var k = jdn - jdn1f;
    var jm, jd;

    if (k >= 0) {
      if (k <= 185) {
        jm = 1 + div(k, 31);
        jd = mod(k, 31) + 1;
        return { jy: jy, jm: jm, jd: jd };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  var JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  var GREGORIAN_MONTHS = ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
    'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];

  function isLeapJalaaliYear(jy) {
    var r = jalCal(jy, false);
    return !!r && r.leap === 0;
  }

  function jalaaliMonthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return isLeapJalaaliYear(jy) ? 30 : 29;
  }

  function isValidJalali(jy, jm, jd) {
    if (!isFinite(jy) || !isFinite(jm) || !isFinite(jd)) return false;
    if (jy < 1278 || jy > 3177) return false;
    if (jm < 1 || jm > 12) return false;
    if (jd < 1 || jd > jalaaliMonthLength(jy, jm)) return false;
    return true;
  }

  function toJalali(gy, gm, gd) {
    var jdn = g2d(gy, gm, gd);
    var res = d2j(jdn);
    return { jy: res.jy, jm: res.jm, jd: res.jd };
  }

  function toGregorian(jy, jm, jd) {
    var jdn = j2d(jy, jm, jd);
    if (jdn === null) return null;
    var res = d2g(jdn);
    return { gy: res.gy, gm: res.gm, gd: res.gd };
  }

  /** قالب‌بندی عدد به رقم فارسی */
  function toPersianDigits(str) {
    var fa = '۰۱۲۳۴۵۶۷۸۹';
    return String(str).replace(/[0-9]/g, function (d) { return fa[+d]; });
  }

  function formatJalali(jy, jm, jd) {
    return toPersianDigits(
      jy + '/' + String(jm).padStart(2, '0') + '/' + String(jd).padStart(2, '0')
    );
  }

  function formatJalaliLong(jy, jm, jd) {
    return toPersianDigits(jd) + ' ' + JALALI_MONTHS[jm - 1] + ' ' + toPersianDigits(jy);
  }

  function formatGregorian(gy, gm, gd) {
    return toPersianDigits(
      gy + '/' + String(gm).padStart(2, '0') + '/' + String(gd).padStart(2, '0')
    );
  }

  function formatGregorianLong(gy, gm, gd) {
    return toPersianDigits(gd) + ' ' + GREGORIAN_MONTHS[gm - 1] + ' ' + toPersianDigits(gy);
  }

  /** تجزیه رشته تاریخ شمسی: "1403/1/15" یا "1403-01-15" یا "۱۴۰۳/۰۱/۱۵" */
  function parse(input) {
    if (!input) return null;
    var normalized = String(input)
      .replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); })
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
      .replace(/[.\-\s]/g, '/')
      .trim();
    var parts = normalized.split('/');
    if (parts.length !== 3) return null;
    var jy = parseInt(parts[0], 10);
    var jm = parseInt(parts[1], 10);
    var jd = parseInt(parts[2], 10);
    if (!isValidJalali(jy, jm, jd)) return null;
    return { jy: jy, jm: jm, jd: jd };
  }

  global.Jalali = {
    toJalali: toJalali,
    toGregorian: toGregorian,
    isLeapJalaaliYear: isLeapJalaaliYear,
    isValidJalali: isValidJalali,
    jalaaliMonthLength: jalaaliMonthLength,
    formatJalali: formatJalali,
    formatJalaliLong: formatJalaliLong,
    formatGregorian: formatGregorian,
    formatGregorianLong: formatGregorianLong,
    toPersianDigits: toPersianDigits,
    parse: parse,
    monthNames: JALALI_MONTHS
  };
})(typeof window !== 'undefined' ? window : self);
