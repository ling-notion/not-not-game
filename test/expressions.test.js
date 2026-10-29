const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/expressions.js');

const { atom, not, or, and, ANYTHING, NOTHING, evaluate, toText } = N;
// Every generator call has a previous key, so memory prompts are in the mix.
const CTX = { lastKey: 'up' };
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
  assert.ok(N.timeLimit(6, 1000, simple) >= 1150);
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
    for (let i = 0; i < 300; i++) evaluate(next(level, CTX));
  }
});

test('"press nothing" stays occasional at high levels', () => {
  const next = N.createGenerator(N.makeRng(7));
  let nothing = 0;
  const runs = 2000;
  for (let i = 0; i < runs; i++) if (evaluate(next(6, CTX)).size === 0) nothing++;
  assert.ok(nothing / runs < 0.25, `nothing rate ${nothing / runs}`);
});

test('"and" only joins one-key items at the top, and nothing is only said outright', () => {
  const next = N.createGenerator(N.makeRng(11));
  for (let level = 0; level < N.LEVELS.length; level++) {
    for (let i = 0; i < 500; i++) {
      const e = next(level, CTX);
      const text = toText(e);
      if (evaluate(e).size === 0) assert.match(text, /nothing|anything/, text);
      if (/\band\b/.test(text)) {
        assert.equal(e.type, 'all', text);
        e.items.forEach((item) => assert.equal(evaluate(item).size, 1, text));
        assert.equal(evaluate(e).size, e.items.length, text);
      }
    }
  }
});

// Reads prompt text back with standard precedence (not > and > or) so the parentheses can be checked.
function parse(text) {
  const toks = text.match(/\(|\)|[a-z]+/g);
  let i = 0;
  const word = (w) => { const k = N.KEYS.find((k) => k.dir === w || k.color === w || k.shape === w); return atom(k.dir === w ? 'dir' : k.color === w ? 'color' : 'shape', w); };
  const primary = () => {
    const t = toks[i++];
    if (t === 'not') return not(primary());
    if (t === '(') { const e = orExpr(); i++; return e; }
    if (t === 'missing') return N.missing([primary(), primary(), primary()]);
    if (t === 'nothing') return NOTHING;
    if (t === 'last') { i++; return N.lastKey(CTX.lastKey); }
    if (t === 'anything') return ANYTHING;
    return word(t);
  };
  const orExpr = () => { let e = primary(); while (toks[i] === 'or') { i++; e = or(e, primary()); } return e; };
  // Generated "and" is always top level: a list of keys to press.
  const items = [orExpr()];
  while (toks[i] === 'and') { i++; items.push(orExpr()); }
  return items.length > 1 ? N.all(items) : items[0];
}

test('prompt text means exactly what the game grades', () => {
  const next = N.createGenerator(N.makeRng(23));
  for (let level = 0; level < N.LEVELS.length; level++) {
    for (let i = 0; i < 1000; i++) {
      const e = next(level, CTX);
      const text = toText(e);
      assert.deepEqual([...evaluate(parse(text))].sort(), ids(e), text);
      // "nothing" combined with "or" reads as "pressing nothing is fine", which the grading can't express.
      assert.doesNotMatch(text, /\bor (not )*(nothing|anything)\b|\b(nothing|anything) or\b/, text);
    }
  }
});

test('"or" prompts are never redundant or always-true', () => {
  const down = atom('dir', 'down');
  assert.ok(N.hasPointlessOr(or(not(down), down)));
  assert.ok(N.hasPointlessOr(or(atom('color', 'yellow'), atom('shape', 'star'))));
  assert.ok(!N.hasPointlessOr(or(atom('color', 'red'), down)));
  const next = N.createGenerator(N.makeRng(31));
  for (let level = 0; level < N.LEVELS.length; level++) {
    for (let i = 0; i < 1000; i++) {
      const e = next(level, CTX);
      assert.ok(!N.hasPointlessOr(e), toText(e));
    }
  }
});

test('compound formats never repeat within two prompts', () => {
  assert.equal(N.formatOf(not(not(or(atom('dir', 'up'), atom('color', 'blue'))))), 'not not ( x or x )');
  const next = N.createGenerator(N.makeRng(41));
  for (let level = 0; level < N.LEVELS.length; level++) {
    const formats = Array.from({ length: 1000 }, () => N.formatOf(next(level, CTX)));
    formats.forEach((f, i) => {
      if (f === 'x') return;
      assert.ok(f !== formats[i - 1] && f !== formats[i - 2], `level ${level}: "${f}" repeated at ${i}`);
    });
  }
});

test('"last key" prompts use the previous key and need one to exist', () => {
  assert.deepEqual(ids(N.lastKey('left')), ['left']);
  assert.deepEqual(ids(not(N.lastKey('left'))), ['down', 'right', 'up']);
  const next = N.createGenerator(N.makeRng(51));
  const memoryLevel = N.LEVELS.findIndex((l) => l.intro.includes('last key'));
  let seen = 0;
  for (let i = 0; i < 500; i++) {
    assert.doesNotMatch(toText(next(memoryLevel)), /last key/);
    const e = next(memoryLevel, { lastKey: 'down' });
    if (toText(e).includes('last key')) seen++;
  }
  assert.ok(seen > 100, `memory prompts seen: ${seen}`);
});

test('shuffling moves every color and shape to a new arrow, keeping directions', () => {
  const rng = N.makeRng(61);
  for (let i = 0; i < 50; i++) {
    const before = N.KEYS.map((k) => k.color);
    N.shuffleLayout(rng);
    N.KEYS.forEach((k, j) => {
      assert.notEqual(k.color, before[j]);
      assert.equal(k.dir, ['up', 'right', 'down', 'left'][j]);
    });
    assert.equal(new Set(N.KEYS.map((k) => k.shape)).size, 4);
  }
  N.resetLayout();
  assert.deepEqual(ids(atom('color', 'red')), ['up']);
});

test('"missing" prompts list three distinct keys and accept only the fourth', () => {
  const m = N.missing([atom('color', 'red'), atom('shape', 'star'), atom('dir', 'down')]);
  assert.equal(toText(m), 'missing: red star down');
  assert.deepEqual(ids(m), ['right']);
  const next = N.createGenerator(N.makeRng(71));
  const level = N.LEVELS.findIndex((l) => l.intro.includes('missing'));
  let seen = 0;
  for (let i = 0; i < 500; i++) {
    const e = next(level, CTX);
    if (e.type !== 'missing') continue;
    seen++;
    assert.equal(new Set(e.items.flatMap((item) => [...evaluate(item)])).size, 3, toText(e));
    assert.equal(evaluate(e).size, 1, toText(e));
  }
  assert.ok(seen > 80, `missing prompts seen: ${seen}`);
});

test('difficulty stays under each level\'s cap, features new mechanics, and keeps some easy prompts', () => {
  const next = N.createGenerator(N.makeRng(81));
  N.LEVELS.forEach((level, index) => {
    const prompts = Array.from({ length: 1500 }, () => next(index, CTX));
    prompts.forEach((e) => assert.ok(N.difficulty(e) <= level.cap, `${level.id}: ${toText(e)} = ${N.difficulty(e)}`));
    if (['not', 'nothing', 'or', 'and', 'missing', 'memory'].includes(level.id)) {
      const share = prompts.filter((e) => N.mechanicsOf(e).has(level.id)).length / prompts.length;
      assert.ok(share > 0.2, `${level.id} featured in ${share}`);
    }
    if (index >= 7) {
      const easy = prompts.filter((e) => N.difficulty(e) <= 1.5).length / prompts.length;
      assert.ok(easy > 0.01 && easy < 0.2, `${level.id} easy share ${easy}`);
    }
  });
});

test('"and" prompts need every named key', () => {
  const e = N.all([atom('color', 'red'), atom('shape', 'star')]);
  assert.equal(toText(e), 'red and star');
  assert.ok(N.needsAll(e));
  assert.deepEqual(ids(e), ['left', 'up']);
  assert.ok(N.difficulty(N.all([atom('dir', 'up'), atom('dir', 'down'), atom('dir', 'left')])) > N.difficulty(e));
});

test('no word repeats in back-to-back prompts, and no answer three times running', () => {
  const next = N.createGenerator(N.makeRng(91));
  const words = (e) => N.toTokens(e).filter((t) => t.atom && t.atom.attr !== 'last').map((t) => t.atom.value);
  N.LEVELS.forEach((_, level) => {
    const prompts = Array.from({ length: 800 }, () => next(level, CTX));
    prompts.forEach((e, i) => {
      if (!i) return;
      const shared = words(e).filter((w) => words(prompts[i - 1]).includes(w));
      assert.deepEqual(shared, [], `${toText(prompts[i - 1])} -> ${toText(e)}`);
      if (i < 2) return;
      const key = (x) => ids(x).join(',');
      assert.ok(!(key(e) === key(prompts[i - 1]) && key(e) === key(prompts[i - 2])), `level ${level}: ${toText(e)} x3`);
    });
  });
});
