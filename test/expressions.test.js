const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/expressions.js');

const { atom, not, or, and, ANYTHING, NOTHING, evaluate, toText } = N;
const ids = (e) => [...evaluate(e)].sort();

test('atoms match by direction, color, and shape', () => {
  assert.deepEqual(ids(atom('color', 'green')), ['right']);
  assert.deepEqual(ids(atom('dir', 'up')), ['up']);
  assert.deepEqual(ids(atom('shape', 'triangle')), ['down']);
});

test('negation and double negation', () => {
  assert.deepEqual(ids(not(atom('color', 'red'))), ['down', 'left', 'right']);
  assert.deepEqual(ids(not(not(atom('color', 'green')))), ['right']);
});

test('nothing and anything', () => {
  assert.deepEqual(ids(NOTHING), []);
  assert.deepEqual(ids(ANYTHING), ['down', 'left', 'right', 'up']);
  assert.deepEqual(ids(not(ANYTHING)), []);
  assert.deepEqual(ids(not(NOTHING)), ['down', 'left', 'right', 'up']);
});

test('or and and', () => {
  assert.deepEqual(ids(or(atom('color', 'red'), atom('dir', 'left'))), ['left', 'up']);
  assert.deepEqual(ids(and(atom('color', 'red'), atom('shape', 'circle'))), ['up']);
  assert.deepEqual(ids(and(atom('color', 'red'), atom('shape', 'square'))), []);
});

test('text adds parentheses only where needed', () => {
  assert.equal(toText(not(not(atom('color', 'green')))), 'not not green');
  assert.equal(toText(not(or(atom('color', 'red'), atom('dir', 'up')))), 'not (red or up)');
  assert.equal(toText(or(not(atom('color', 'red')), atom('dir', 'up'))), 'not red or up');
  assert.equal(toText(and(or(atom('dir', 'up'), atom('dir', 'down')), atom('color', 'red'))), '(up or down) and red');
});

test('level timeline and time limits', () => {
  assert.equal(N.levelFor(0), 0);
  assert.equal(N.levelFor(5.9), 0);
  assert.equal(N.levelFor(6), 1);
  assert.equal(N.levelFor(500), N.LEVELS.length - 1);
  const simple = atom('dir', 'up');
  assert.ok(N.timeLimit(0, 0, simple) > N.timeLimit(5, 120, simple));
  assert.ok(N.timeLimit(6, 1000, simple) >= 950);
});

test('generator only uses introduced rules and never repeats a prompt back to back', () => {
  const next = N.createGenerator(N.makeRng(42));
  let prev = '';
  for (let i = 0; i < 200; i++) {
    const e = next(0);
    assert.equal(e.type, 'atom');
    assert.notEqual(toText(e), prev);
    prev = toText(e);
  }
  for (let level = 0; level < N.LEVELS.length; level++) {
    for (let i = 0; i < 300; i++) evaluate(next(level));
  }
});

test('"press nothing" stays occasional at high levels', () => {
  const next = N.createGenerator(N.makeRng(7));
  let nothing = 0;
  const runs = 2000;
  for (let i = 0; i < runs; i++) if (evaluate(next(6)).size === 0) nothing++;
  assert.ok(nothing / runs < 0.25, `nothing rate ${nothing / runs}`);
});

test('generated prompts never use "and", and only say nothing outright', () => {
  const next = N.createGenerator(N.makeRng(11));
  for (let level = 0; level < N.LEVELS.length; level++) {
    for (let i = 0; i < 500; i++) {
      const e = next(level);
      const text = toText(e);
      if (evaluate(e).size === 0) assert.match(text, /nothing|anything/, text);
      assert.doesNotMatch(text, /\band\b/, text);
    }
  }
});
