// Layout regression tests for the broadcasting graph in src/renderer.js
//
// Run with:  node tests/renderer-layout.test.js
//
// Loads the real renderer against a stubbed DOM/canvas that records every draw
// operation, runs one render pass, and checks that the second labels
// (0, 10, ..., 60) are fully inside the canvas and never covered by the
// signal bars. Guards against the tick-label clipping bug.

'use strict';

const fs = require('fs');
const path = require('path');

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

// ---------- stubs ----------
const WIDTH = 1000;
const HEIGHT = 230;

global.TimeSource = {
  now: () => 12_345_678_901,              // .901 s -> second 58, progress 0.901
  date: () => new Date(12_345_678_901),
};

const texts = [];   // { text, x, y } from fillText
const rects = [];   // { x, y, w, h } from fillRect
const ctx2d = {
  clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set font(v) {},
  fillText(text, x, y) { texts.push({ text: String(text), x, y }); },
  fillRect(x, y, w, h) { rects.push({ x, y, w, h }); },
};

const documentStub = {
  getElementById: () => ({
    width: WIDTH, height: HEIGHT,
    getContext: () => ctx2d,
    textContent: '', innerHTML: '',
  }),
  createElement: () => ({ className: '', textContent: '', outerHTML: '' }),
};

// Load the real renderer; requestAnimationFrame is stubbed so render() runs
// exactly once per explicit call.
const windowStub = {};
new Function('document', 'window', 'requestAnimationFrame',
  fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8'))(
  documentStub, windowStub,
  () => {}
);

const protocol = {
  formatDate: () => 'X: 00:00:00',
  drawBar: (c, v, i, n, x, y, w, h) => c.fillRect(x + 2, y, w - 4, h), // real bar geometry
};

const renderer = new windowStub.SignalRenderer(
  'canvas',
  () => new Array(60).fill(0.9),
  () => protocol,
  null
);
renderer.render();

// Text box approximating an 11px font: ascent above the baseline, descent below.
function labelBox(t) { return { x0: t.x - 1, x1: t.x + 20, y0: t.y - 11, y1: t.y + 3 }; }

// ---------- tests ----------
test('all seven second labels (0,10,...,60) are drawn', () => {
  for (const label of ['0', '10', '20', '30', '40', '50', '60']) {
    assert(texts.some(t => t.text === label), 'missing label "' + label + '"');
  }
});

test('second labels fit inside the canvas', () => {
  for (const label of ['0', '10', '20', '30', '40', '50', '60']) {
    const t = texts.find(o => o.text === label);
    const box = labelBox(t);
    assert(box.y0 >= 0 && box.y1 <= HEIGHT,
      'label "' + label + '" at y=' + t.y + ' spans ' + box.y0 + '..' + box.y1 +
      ' but canvas height is ' + HEIGHT);
  }
});

test('second labels are not covered by signal bars', () => {
  for (const t of texts) {
    const box = labelBox(t);
    for (const r of rects) {
      const overlaps = r.x < box.x1 && r.x + r.w > box.x0 &&
                       r.y < box.y1 && r.y + r.h > box.y0;
      assert(!overlaps,
        'label "' + t.text + '" (y=' + t.y + ') is covered by bar rect (' +
        r.x + ',' + r.y + ',' + r.w + ',' + r.h + ')');
    }
  }
});

test('signal bars and labels stay inside the canvas', () => {
  for (const r of rects) {
    assert(r.y >= 0 && r.y + r.h <= HEIGHT,
      'bar rect (' + r.x + ',' + r.y + ',' + r.w + ',' + r.h + ') exceeds canvas height ' + HEIGHT);
  }
});

// ---------- summary ----------
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
