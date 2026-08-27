// Protocol conformance tests for src/{wwvb,dcf77,jjy,msf,bpc}.js
//
// Run with:  node tests/protocols.test.js
//
// No dependencies: Web Audio is stubbed and each protocol module is loaded in a
// fresh VM sandbox, so its module state (persistent carriers, etc.) is isolated
// per protocol under test. Frames are decoded bit-by-bit and checked against
// the official specifications (NIST / PTB / NICT / NPL) and, for BPC, against a
// documented real-signal capture.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------- tiny test framework ----------
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    failures.push(name + '\n      ' + e.message);
    console.log('FAIL  ' + name + '\n      ' + e.message);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'assertEq') + ': expected ' + expected + ', got ' + actual);
  }
}

// ---------- Web Audio stub ----------
function makeCtx() {
  const counts = { osc: 0, gain: 0 };
  const ctx = {
    currentTime: 100.0,
    destination: { stub: true },
    createOscillator() {
      counts.osc++;
      return { type: null, frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
    },
    createGain() {
      counts.gain++;
      return { gain: { setValueAtTime() {} }, connect() {} };
    }
  };
  return { ctx, counts };
}

function loadProtocol(name) {
  const sandbox = { window: { TimeProtocols: {} } };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', name + '.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: name + '.js' });
  return sandbox.window.TimeProtocols[name];
}

const H = 3600 * 1000;
function utc(iso) { return new Date(iso).getTime(); }

// ============ WWVB ============
(function () {
  console.log('\nWWVB  (NIST 60 kHz time code)');
  const p = loadProtocol('wwvb');
  const { ctx } = makeCtx();

  // Decode a frame (array of reduced-carrier durations) into a bit map.
  // 0.8 s = position marker P, 0.5 s = binary 1, 0.2 s = binary 0.
  function decode(arr) {
    const bits = arr.map(v => v === 0.8 ? 'P' : (v === 0.5 ? 1 : 0));
    [0, 9, 19, 29, 39, 49, 59].forEach(s => assertEq(bits[s], 'P', 'marker at ' + s));
    const sum = w => Object.keys(w).reduce((s, i) => s + (bits[i] === 1 ? w[i] : 0), 0);
    return {
      minute: sum({ 1: 40, 2: 20, 3: 10, 5: 8, 6: 4, 7: 2, 8: 1 }),
      hour:   sum({ 12: 20, 13: 10, 15: 8, 16: 4, 17: 2, 18: 1 }),
      day:    sum({ 22: 200, 23: 100, 25: 80, 26: 40, 27: 20, 28: 10, 30: 8, 31: 4, 32: 2, 33: 1 }),
      year:   sum({ 45: 80, 46: 40, 47: 20, 48: 10, 50: 8, 51: 4, 52: 2, 53: 1 }),
      leapYear: bits[55],
      dst: (bits[57] === 1 ? 2 : 0) + (bits[58] === 1 ? 1 : 0),
      onesInUnused: [4, 10, 11, 14, 20, 21, 24, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 54, 56]
        .filter(i => bits[i] === 1)
    };
  }

  function frame(iso) { return p.schedule(new Date(utc(iso)), ctx, {}, utc(iso)); }

  function checkFields(iso, label) {
    const d = new Date(utc(iso));
    const day = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
    const f = decode(frame(iso));
    assertEq(f.minute, d.getUTCMinutes(), label + ' minute');
    assertEq(f.hour, d.getUTCHours(), label + ' hour');
    assertEq(f.day, day, label + ' day of year');
    assertEq(f.year, d.getUTCFullYear() % 100, label + ' year');
    assertEq(f.onesInUnused.length, 0,
      label + ' unused bits must be 0 (violated at ' + f.onesInUnused + ')');
    return f;
  }

  test('encodes UTC fields correctly (winter)', () => {
    const f = checkFields('2026-02-15T12:34:00Z', 'winter');
    assertEq(f.dst, 0, 'DST bits 00 in winter');
    assertEq(f.leapYear, 0, '2026 is not a leap year');
  });

  test('encodes DST in effect as 11', () => {
    const f = checkFields('2026-06-15T12:34:00Z', 'summer');
    assertEq(f.dst, 3, 'DST bits 11 in summer');
  });

  // 2026: DST begins Sun Mar 8, 07:00 UTC; ends Sun Nov 1, 06:00 UTC.
  test('spring transition Sunday sends 10 all day (enhanced format)', () => {
    assertEq(decode(frame('2026-03-08T06:00Z')).dst, 2, 'before 2:00 local');
    assertEq(decode(frame('2026-03-08T12:00Z')).dst, 2, 'after 2:00 local');
    assertEq(decode(frame('2026-03-07T12:00Z')).dst, 0, 'Saturday before: plain 00');
    assertEq(decode(frame('2026-03-09T12:00Z')).dst, 3, 'Monday after: plain 11');
  });

  test('fall transition Sunday sends 01 all day (enhanced format)', () => {
    assertEq(decode(frame('2026-11-01T05:00Z')).dst, 1, 'before 2:00 local');
    assertEq(decode(frame('2026-11-01T12:00Z')).dst, 1, 'after 2:00 local');
    assertEq(decode(frame('2026-10-31T12:00Z')).dst, 3, 'Saturday before: plain 11');
    assertEq(decode(frame('2026-11-02T12:00Z')).dst, 0, 'Monday after: plain 00');
  });

  test('leap-year bit set in leap years', () => {
    assertEq(decode(frame('2028-02-15T12:34:00Z')).leapYear, 1, '2028 LY bit');
  });

  test('pulse durations restricted to 0.8/0.5/0.2', () => {
    frame('2026-02-15T12:34:00Z').forEach(v =>
      assert(v === 0.8 || v === 0.5 || v === 0.2, 'bad pulse ' + v));
  });
})();

// ============ DCF77 ============
(function () {
  console.log('\nDCF77 (PTB 77.5 kHz time code)');
  const p = loadProtocol('dcf77');

  function frame(iso, ctx) { return p.schedule(new Date(utc(iso)), ctx, {}); }

  // 0.1 s drop = binary 0, 0.2 s = binary 1, second 59 = no drop.
  function decode(arr) {
    assertEq(arr.length, 60, 'frame length');
    assertEq(arr[59], 0, 'second 59 must be unmodulated (minute mark)');
    for (let i = 0; i < 59; i++) {
      assert(arr[i] === 0.1 || arr[i] === 0.2, 'bad drop at second ' + i + ': ' + arr[i]);
    }
    const bits = arr.map(v => v === 0.2 ? 1 : 0);
    const parity = (a, b) => {
      let s = 0;
      for (let i = a; i <= b; i++) s += bits[i];
      return s % 2;
    };
    return { bits, parity };
  }

  test('encodes next minute CET/CEST with valid parity (summer)', () => {
    const { ctx } = makeCtx();
    const { bits, parity } = decode(frame('2026-06-15T10:30:00Z', ctx));
    // CEST = UTC+2 -> frame transmitted at 10:30 UTC encodes 12:31 CEST
    assertEq(bits[20], 1, 'start bit S (bit 20)');
    assertEq(bits[21] + bits[22] * 2 + bits[23] * 4 + bits[24] * 8, 1, 'minute units');
    assertEq(bits[25] + bits[26] * 2 + bits[27] * 4, 3, 'minute tens');
    assertEq(parity(21, 27), bits[28], 'P1 even parity (minute)');
    assertEq(bits[29] + bits[30] * 2 + bits[31] * 4 + bits[32] * 8, 2, 'hour units');
    assertEq(bits[33] + bits[34] * 2, 1, 'hour tens');
    assertEq(parity(29, 34), bits[35], 'P2 even parity (hour)');
    assertEq(bits[36] + bits[37] * 2 + bits[38] * 4 + bits[39] * 8, 5, 'day units');
    assertEq(bits[40] + bits[41] * 2, 1, 'day tens');
    const wd = bits[42] + bits[43] * 2 + bits[44] * 4;
    assertEq(wd, new Date(utc('2026-06-15T12:31:00Z')).getUTCDay() || 7, 'weekday 1=Mon..7=Sun');
    assertEq(bits[45] + bits[46] * 2 + bits[47] * 4 + bits[48] * 8, 6, 'month units');
    assertEq(bits[49], 0, 'month tens');
    assertEq(bits[50] + bits[51] * 2 + bits[52] * 4 + bits[53] * 8 +
             (bits[54] + bits[55] * 2 + bits[56] * 4 + bits[57] * 8) * 10, 26, 'year');
    assertEq(parity(36, 57), bits[58], 'P3 even parity (date)');
    assertEq(bits[17], 1, 'Z1=1 in CEST');
    assertEq(bits[18], 0, 'Z2=0 in CEST');
  });

  test('Z bits flip in winter (CET)', () => {
    const { ctx } = makeCtx();
    const { bits } = decode(frame('2026-01-15T10:30:00Z', ctx));
    assertEq(bits[17], 0, 'Z1=0 in CET');
    assertEq(bits[18], 1, 'Z2=1 in CET');
  });

  test('bit 16 set during the hour before DST transitions', () => {
    // 2026: CEST starts Sun Mar 29, 01:00 UTC; ends Sun Oct 25, 01:00 UTC.
    const { ctx } = makeCtx();
    assertEq(decode(frame('2026-03-29T00:30:00Z', ctx)).bits[16], 1, 'spring announcement');
    assertEq(decode(frame('2026-03-28T23:30:00Z', ctx)).bits[16], 0, 'two hours before: off');
    assertEq(decode(frame('2026-03-29T01:00:00Z', ctx)).bits[16], 0, 'after transition: off');
    assertEq(decode(frame('2026-10-25T00:30:00Z', ctx)).bits[16], 1, 'fall announcement');
  });

  test('regression: single persistent carrier, no per-minute oscillators', () => {
    const { ctx, counts } = makeCtx();
    frame('2026-06-15T10:30:00Z', ctx);
    assertEq(counts.osc, 1, 'one oscillator after first minute');
    assertEq(counts.gain, 1, 'one gain node after first minute');
    frame('2026-06-15T10:31:00Z', ctx);
    frame('2026-06-15T10:32:00Z', ctx);
    assertEq(counts.osc, 1, 'carrier reused across minutes (no shadowing leak)');
    assertEq(counts.gain, 1, 'gain node reused across minutes (no shadowing leak)');
  });

  test('new session (fresh AudioContext) creates exactly one carrier', () => {
    const { ctx, counts } = makeCtx();
    frame('2026-06-15T10:30:00Z', ctx);
    assertEq(counts.osc, 1, 'one carrier per session');
  });
})();

// ============ JJY ============
(function () {
  console.log('\nJJY   (NICT 40/60 kHz time code)');
  const p = loadProtocol('jjy');

  function frame(iso, ctx, optStates, nowMs) {
    return p.schedule(new Date(utc(iso)), ctx, optStates || [false, false],
                      typeof nowMs === 'number' ? nowMs : utc(iso));
  }

  // Full-amplitude pulse widths: 0.2 s = marker, 0.8 s = binary 0, 0.5 s = binary 1.
  function decode(arr) {
    assertEq(arr.length, 60, 'frame length');
    const bits = arr.map(v => v === 0.5 ? 1 : 0);
    [0, 9, 19, 29, 39, 49, 59].forEach(s => assertEq(arr[s], 0.2, 'marker pulse at ' + s));
    const val = w => Object.keys(w).reduce((s, i) => s + (bits[i] === 1 ? w[i] : 0), 0);
    return { bits, val };
  }

  test('encodes JST fields with even parity at PA1/PA2', () => {
    const { ctx } = makeCtx();
    // 2026-06-15T00:30Z -> JST 09:30 Monday (current-minute encoding); day of year = 166
    const t = utc('2026-06-15T00:30:00Z');
    const { bits, val } = decode(frame('2026-06-15T00:30:00Z', ctx, [false, false], t));
    assertEq(val({ 1: 40, 2: 20, 3: 10, 5: 8, 6: 4, 7: 2, 8: 1 }), 30, 'minute');
    assertEq(val({ 12: 20, 13: 10, 15: 8, 16: 4, 17: 2, 18: 1 }), 9, 'hour');
    assertEq(val({ 22: 200, 23: 100, 25: 80, 26: 40, 27: 20, 28: 10, 30: 8, 31: 4, 32: 2, 33: 1 }),
      166, 'day of year');
    assertEq(val({ 41: 80, 42: 40, 43: 20, 44: 10, 45: 8, 46: 4, 47: 2, 48: 1 }), 26, 'year');
    assertEq(val({ 50: 4, 51: 2, 52: 1 }), 1, 'weekday (Mon=1)');
    assertEq(bits[53], 0, 'LS1=0 (no leap second)');
    assertEq(bits[54], 0, 'LS2=0 (no leap second)');
    const pc = w => { let s = 0; for (const i of Object.keys(w)) if (bits[i] === 1) s++; return s; };
    assertEq((pc({ 12: 1, 13: 1, 15: 1, 16: 1, 17: 1, 18: 1 }) + bits[36]) % 2, 0, 'PA1 even parity');
    assertEq((pc({ 1: 1, 2: 1, 3: 1, 5: 1, 6: 1, 7: 1, 8: 1 }) + bits[37]) % 2, 0, 'PA2 even parity');
  });

  test('officially unused bits always 0 (incl. greedy 16/160 weight traps)', () => {
    const { ctx } = makeCtx();
    const { bits } = decode(frame('2026-08-01T12:00:00Z', ctx));
    [4, 10, 11, 14, 20, 21, 24, 34, 35, 38, 40, 55, 56, 57, 58].forEach(i =>
      assertEq(bits[i], 0, 'unused bit ' + i + ' must be 0'));
  });

  test('leap second flags: positive leap second = LS1,LS2 = 1,1', () => {
    const { ctx } = makeCtx();
    const mid = decode(frame('2016-12-15T00:00:00Z', ctx));
    assertEq(mid.bits[53], 1, 'LS1 announced');
    assertEq(mid.bits[54], 1, 'LS2 = positive');
    const after = decode(frame('2017-01-02T00:00:00Z', ctx));
    assertEq(after.bits[53], 0, 'LS1 cleared after the event');
  });

  test('pulse durations restricted to 0.2/0.5/0.8', () => {
    const { ctx } = makeCtx();
    frame('2026-06-15T00:30:00Z', ctx).forEach(v =>
      assert(v === 0.2 || v === 0.5 || v === 0.8, 'bad pulse ' + v));
  });
})();

// ============ MSF ============
(function () {
  console.log('\nMSF   (NPL 60 kHz time code)');
  const p = loadProtocol('msf');

  function frame(iso, ctx) { return p.schedule(new Date(utc(iso)), ctx, {}); }

  // Carrier-off durations: 100 ms = A0,B0 · 200 ms = A1,B0 · 300 ms = A1,B1 · 500 ms = minute mark.
  function decode(arr) {
    assertEq(arr.length, 60, 'frame length');
    assertEq(arr[0], 0.5, 'second 0 must be the 500 ms minute marker');
    assertEq(arr[52], 0.1, 's52 = A0,B0');
    assertEq(arr[59], 0.1, 's59 = A0,B0');
    const a = arr.map(v => v >= 0.2 ? 1 : 0);
    const b = arr.map(v => (v === 0.3 || v === 0.5) ? 1 : 0);
    const val = w => Object.keys(w).reduce((s, i) => s + (a[i] === 1 ? w[i] : 0), 0);
    return { arr, a, b, val };
  }

  function oddParity(f, i0, i1, pb) {
    let s = f.b[pb] ? 1 : 0;
    for (let i = i0; i <= i1; i++) s += f.a[i] ? 1 : 0;
    return s % 2 === 1;
  }

  test('encodes next minute UK time with odd parity (winter/GMT)', () => {
    const { ctx } = makeCtx();
    const f = decode(frame('2026-01-15T10:30:00Z', ctx));
    // GMT (UTC+0): frame transmitted at 10:30 encodes 10:31 on Thu 2026-01-15
    assertEq(f.val({ 17: 80, 18: 40, 19: 20, 20: 10, 21: 8, 22: 4, 23: 2, 24: 1 }), 26, 'year');
    assertEq(f.val({ 25: 10, 26: 8, 27: 4, 28: 2, 29: 1 }), 1, 'month');
    assertEq(f.val({ 30: 20, 31: 10, 32: 8, 33: 4, 34: 2, 35: 1 }), 15, 'day');
    assertEq(f.val({ 36: 4, 37: 2, 38: 1 }), new Date(utc('2026-01-15T10:31:00Z')).getUTCDay(),
      'weekday 0=Sunday');
    assertEq(f.val({ 39: 20, 40: 10, 41: 8, 42: 4, 43: 2, 44: 1 }), 10, 'hour');
    assertEq(f.val({ 45: 40, 46: 20, 47: 10, 48: 8, 49: 4, 50: 2, 51: 1 }), 31, 'minute');
    assert(oddParity(f, 17, 24, 54), 'P1 odd parity (year)');
    assert(oddParity(f, 25, 35, 55), 'P2 odd parity (month+day)');
    assert(oddParity(f, 36, 38, 56), 'P3 odd parity (weekday)');
    assert(oddParity(f, 39, 51, 57), 'P4 odd parity (hour+minute)');
    assertEq(f.b[58], 0, '58B=0 while GMT');
    assertEq(f.b[53], 0, '53B=0 outside warning hour');
    for (let i = 1; i <= 16; i++) assertEq(f.a[i], 0, 'DUT1/reserved A bit at ' + i);
  });

  test('s53B=1 during the hour before BST transitions', () => {
    // 2026: BST starts Sun Mar 29, 01:00 UTC; ends Sun Oct 25, 01:00 UTC.
    const { ctx } = makeCtx();
    assertEq(decode(frame('2026-03-29T00:30:00Z', ctx)).b[53], 1, 'spring warning');
    assertEq(decode(frame('2026-03-28T23:30:00Z', ctx)).b[53], 0, 'no warning two hours before');
    assertEq(decode(frame('2026-10-25T00:30:00Z', ctx)).b[53], 1, 'fall warning');
  });

  test('58B=1 while BST is in effect; BST offset applied', () => {
    const { ctx } = makeCtx();
    const f = decode(frame('2026-06-15T10:30:00Z', ctx));
    assertEq(f.b[58], 1, '58B=1 during BST');
    // BST = UTC+1: frame transmitted at 10:30 UTC encodes 11:31 BST
    assertEq(f.val({ 39: 20, 40: 10, 41: 8, 42: 4, 43: 2, 44: 1 }), 11, 'hour (11:31 BST)');
    assertEq(f.val({ 45: 40, 46: 20, 47: 10, 48: 8, 49: 4, 50: 2, 51: 1 }), 31, 'minute');
  });

  test('pulse durations restricted to 0.1/0.2/0.3/0.5', () => {
    const { ctx } = makeCtx();
    frame('2026-01-15T10:30:00Z', ctx).forEach(v =>
      assert([0.1, 0.2, 0.3, 0.5].includes(v), 'bad drop ' + v));
  });
})();

// ============ BPC ============
(function () {
  console.log('\nBPC   (China 68.5 kHz, reverse-engineered format)');
  const p = loadProtocol('bpc');

  function frame(iso, ctx, useLocal) { return p.schedule(new Date(utc(iso)), ctx, !!useLocal); }

  // Drop durations: none = P0 frame start, 100/200/300/400 ms = symbols 0/1/2/3.
  function decode(arr) {
    assertEq(arr.length, 60, 'frame length (3 x 20 s)');
    [0, 20, 40].forEach(s => assertEq(arr[s], 0, 'P0 frame-start marker at ' + s));
    const map = { 0: 0, 0.1: 0, 0.2: 1, 0.3: 2, 0.4: 3 };
    const sym = [];
    for (let s = 0; s < 60; s++) {
      assert(arr[s] in map, 'bad drop at second ' + s + ': ' + arr[s]);
      sym.push(map[arr[s]]);
    }
    return sym;
  }

  // Documented real capture: frame at :40 of 2026-01-10 16:34 CST (Sat),
  // "10 00 0100 100010 0110 10 001010 0001 011010 00" -> 4 PM, minute 34,
  // weekday 6, day 10, month 1, year 26.
  const CAPTURE = [2, 0, 1, 0, 2, 0, 2, 1, 2, 2, 0, 2, 2, 0, 1, 1, 2, 2, 0];

  test('symbol-for-symbol match with documented real capture', () => {
    const { ctx } = makeCtx();
    const sym = decode(frame('2026-01-10T08:34:00Z', ctx)); // = 16:34 CST
    for (let i = 1; i <= 19; i++) {
      assertEq(sym[40 + i], CAPTURE[i - 1], 'frame 2, symbol ' + i + ' (:40 frame)');
    }
  });

  test('CST encoding, frame counters, PM flag across all 3 frames', () => {
    const { ctx } = makeCtx();
    const sym = decode(frame('2026-01-10T08:34:00Z', ctx));
    assertEq(sym[1], 0, 'frame 0 counter');
    assertEq(sym[21], 1, 'frame 1 counter');
    assertEq(sym[41], 2, 'frame 2 counter');
    [2, 22, 42].forEach(i => assertEq(sym[i], 0, 's2 reserved = 0'));
    [0, 20, 40].forEach(off => {
      const h = (sym[off + 3] << 2) | sym[off + 4];
      const m = (sym[off + 5] << 4) | (sym[off + 6] << 2) | sym[off + 7];
      const wd = (sym[off + 8] << 2) | sym[off + 9];
      assertEq(h, 4, 'hour 0-11 (4 PM)');
      assertEq(m, 34, 'minute');
      assertEq(wd, 6, 'weekday Saturday=6');
      assertEq(sym[off + 10] >> 1, 1, 'PM flag');
      assertEq((sym[off + 11] << 4) | (sym[off + 12] << 2) | sym[off + 13], 10, 'day');
      assertEq((sym[off + 14] << 2) | sym[off + 15], 1, 'month');
      assertEq((sym[off + 16] << 4) | (sym[off + 17] << 2) | sym[off + 18], 26, 'year');
      assertEq(sym[off + 19] >> 1, 0, 'year 64-weight bit');
    });
  });

  test('P1/P2 even parity bits', () => {
    const { ctx } = makeCtx();
    const sym = decode(frame('2026-01-10T08:34:00Z', ctx));
    [0, 20, 40].forEach(off => {
      let x = 0;
      for (let i = 1; i <= 9; i++) x ^= (sym[off + i] & 1) ^ ((sym[off + i] >> 1) & 1);
      assertEq(sym[off + 10] & 1, x, 'P1 parity bit');
      let y = 0;
      for (let i = 11; i <= 18; i++) y ^= (sym[off + i] & 1) ^ ((sym[off + i] >> 1) & 1);
      assertEq(sym[off + 19] & 1, y, 'P2 parity bit');
    });
  });

  test('drop durations restricted to 0/0.1/0.2/0.3/0.4', () => {
    const { ctx } = makeCtx();
    decode(frame('2026-01-10T08:34:00Z', ctx)); // decode() asserts the alphabet
  });
})();

// ---------- summary ----------
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.error('\nFailures:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
