// Expression model for the game: build, evaluate, render, and generate prompts.
// Works as a browser global (window.NotNot) and as a CommonJS module for tests.
(function (root) {
  'use strict';

  const KEYS = [
    { id: 'up', code: 'ArrowUp', dir: 'up', color: 'red', shape: 'circle', glyph: '↑' },
    { id: 'right', code: 'ArrowRight', dir: 'right', color: 'green', shape: 'square', glyph: '→' },
    { id: 'down', code: 'ArrowDown', dir: 'down', color: 'blue', shape: 'triangle', glyph: '↓' },
    { id: 'left', code: 'ArrowLeft', dir: 'left', color: 'yellow', shape: 'star', glyph: '←' },
  ];
  const ALL_IDS = KEYS.map((k) => k.id);
  const ATTRS = ['dir', 'color', 'shape'];
  const COLORS = KEYS.map((k) => k.color);

  const atom = (attr, value) => ({ type: 'atom', attr, value });
  const not = (e) => ({ type: 'not', e });
  const or = (a, b) => ({ type: 'or', a, b });
  const and = (a, b) => ({ type: 'and', a, b });
  // "missing: red green blue" lists three keys; the answer is the fourth one, not listed.
  const missing = (items) => ({ type: 'missing', items });
  const ANYTHING = atom('any', 'anything');
  const NOTHING = atom('none', 'nothing');
  // "last key" means the key pressed in the previous round, resolved when the prompt is made.
  const lastKey = (keyId) => ({ type: 'atom', attr: 'last', value: 'last key', key: keyId });

  // Returns the set of key ids that satisfy the expression; empty means "press nothing".
  function evaluate(e) {
    switch (e.type) {
      case 'atom':
        if (e.attr === 'any') return new Set(ALL_IDS);
        if (e.attr === 'none') return new Set();
        if (e.attr === 'last') return new Set([e.key]);
        return new Set(KEYS.filter((k) => k[e.attr] === e.value).map((k) => k.id));
      case 'not': {
        const inner = evaluate(e.e);
        return new Set(ALL_IDS.filter((id) => !inner.has(id)));
      }
      case 'or': {
        const a = evaluate(e.a);
        evaluate(e.b).forEach((id) => a.add(id));
        return a;
      }
      case 'missing': {
        const listed = new Set(e.items.flatMap((item) => [...evaluate(item)]));
        return new Set(ALL_IDS.filter((id) => !listed.has(id)));
      }
      case 'and': {
        const b = evaluate(e.b);
        return new Set([...evaluate(e.a)].filter((id) => b.has(id)));
      }
      default:
        throw new Error('Unknown expression type: ' + e.type);
    }
  }

  const PRECEDENCE = { missing: 0, or: 1, and: 2, not: 3, atom: 4 };

  // Flattens an expression into display tokens, adding parentheses only where precedence needs them.
  function toTokens(e, parentPrec = 0) {
    const prec = PRECEDENCE[e.type];
    let tokens;
    if (e.type === 'atom') tokens = [{ kind: 'atom', text: e.value, atom: e }];
    else if (e.type === 'missing') tokens = [{ kind: 'op', text: 'missing:' }, ...e.items.flatMap((item) => toTokens(item))];
    else if (e.type === 'not') tokens = [{ kind: 'op', text: 'not' }, ...toTokens(e.e, prec)];
    else tokens = [...toTokens(e.a, prec), { kind: 'op', text: e.type }, ...toTokens(e.b, prec + 1)];
    if (prec < parentPrec) tokens = [{ kind: 'paren', text: '(' }, ...tokens, { kind: 'paren', text: ')' }];
    return tokens;
  }

  const toText = (e) => toTokens(e).map((t) => t.text).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');

  function opCount(e) {
    if (e.type === 'atom') return 0;
    if (e.type === 'not') return 1 + opCount(e.e);
    if (e.type === 'missing') return e.items.length - 1;
    return 1 + opCount(e.a) + opCount(e.b);
  }

  // Seconds of play at which each level begins, and the rule each level introduces.
  const LEVELS = [
    { at: 0, intro: 'Press the key that matches' },
    { at: 5, intro: 'New: "not" means anything except' },
    { at: 13, intro: 'New: "nothing" means don\'t press' },
    { at: 27, intro: 'New: "or"' },
    { at: 40, intro: 'New: "last key" means the key you just pressed' },
    { at: 52, intro: 'New: the colors and shapes swap keys', feature: 'shuffle' },
    { at: 64, intro: 'New: press the one that\'s missing' },
    { at: 76, intro: 'New: words lie about their color', feature: 'lyingColors' },
    { at: 88, intro: 'New: symbols instead of words', feature: 'symbols' },
    { at: 100, intro: 'New: prompts fade, so read fast', feature: 'fade' },
    { at: 114, intro: 'Chaos mode', feature: 'lyingSymbols' },
    { at: 140, intro: 'Endless: it only gets faster' },
  ];

  // First level index with a feature flag, e.g. featureLevel('shuffle').
  const featureLevel = (name) => LEVELS.findIndex((l) => l.feature === name);

  // Colors and shapes can move between arrows; directions always stay with their arrow key.
  const HOME_LAYOUT = KEYS.map((k) => ({ color: k.color, shape: k.shape }));

  function resetLayout() {
    KEYS.forEach((k, i) => Object.assign(k, HOME_LAYOUT[i]));
  }

  // Moves every color+shape pair to a different arrow than it has now.
  function shuffleLayout(rng = Math.random) {
    const current = KEYS.map((k) => ({ color: k.color, shape: k.shape }));
    let order;
    do {
      order = [0, 1, 2, 3];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    } while (order.some((from, to) => from === to));
    KEYS.forEach((k, i) => Object.assign(k, current[order[i]]));
  }

  function levelFor(seconds) {
    let level = 0;
    LEVELS.forEach((l, i) => { if (seconds >= l.at) level = i; });
    return level;
  }

  // Answer window in ms: shrinks with level and time, with extra time for longer expressions.
  function timeLimit(level, seconds, expr) {
    // Gentle steps between levels so no single level is a wall; reading time scales with length.
    const base = [2300, 2150, 2000, 1900, 1850, 1850, 1850, 1800, 1750, 1750, 1700, 1650][level];
    const decay = Math.max(0, seconds - LEVELS[level].at) * 4;
    return Math.max(1150, base - decay) + opCount(expr) * 260;
  }

  function makeRng(seed) {
    if (seed === undefined) return Math.random;
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mentionsNothing(expr) {
    if (expr.type === 'atom') return expr.attr === 'none' || expr.attr === 'any';
    if (expr.type === 'not') return mentionsNothing(expr.e);
    if (expr.type === 'missing') return false;
    return mentionsNothing(expr.a) || mentionsNothing(expr.b);
  }

  const isSubset = (a, b) => [...a].every((id) => b.has(id));

  // An "or" is pointless when one side adds nothing ("yellow or star") or together they cover
  // every key ("not down or down"); such prompts read as tricks rather than real statements.
  function hasPointlessOr(expr) {
    if (expr.type === 'atom') return false;
    if (expr.type === 'not') return hasPointlessOr(expr.e);
    if (expr.type === 'missing') return false;
    if (hasPointlessOr(expr.a) || hasPointlessOr(expr.b)) return true;
    if (expr.type !== 'or') return false;
    const a = evaluate(expr.a);
    const b = evaluate(expr.b);
    return isSubset(a, b) || isSubset(b, a) || new Set([...a, ...b]).size === KEYS.length;
  }

  // The prompt's structure with each word blanked out, e.g. "not not (x or x)".
  function formatOf(expr) {
    return toTokens(expr).map((t) => (t.kind === 'atom' && !['none', 'any', 'last'].includes(t.atom.attr) ? 'x' : t.text)).join(' ');
  }

  function createGenerator(rng = Math.random) {
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const randomAtom = (attr = pick(ATTRS)) => atom(attr, pick(KEYS)[attr]);
    const twoAtoms = () => {
      const a = randomAtom();
      let b = randomAtom();
      while (b.attr === a.attr && b.value === a.value) b = randomAtom();
      return [a, b];
    };
    // Memory templates need a previous key; without one they bail out and another template is picked.
    let recentKey = null;
    const NO_MEMORY = new Error('no last key');
    const memory = () => { if (!recentKey) throw NO_MEMORY; return lastKey(recentKey); };
    const threeKeys = () => [...KEYS].sort(() => rng() - 0.5).slice(0, 3);
    // Three distinct values of one attribute, e.g. "missing: red green blue".
    const missingSame = () => {
      const attr = pick(ATTRS);
      return missing(threeKeys().map((k) => atom(attr, k[attr])));
    };
    // Three keys each named by a different-looking attribute, e.g. "missing: red star down".
    const missingMixed = () => missing(threeKeys().map((k) => { const attr = pick(ATTRS); return atom(attr, k[attr]); }));
    const notN = (e, n) => (n === 0 ? e : not(notN(e, n - 1)));

    // Templates grouped by the level that introduces them.
    const TEMPLATES = [
      [() => randomAtom()],
      [() => not(randomAtom()), () => randomAtom()],
      [
        () => notN(randomAtom(), 2),
        () => NOTHING,
        () => ANYTHING,
        () => not(pick([NOTHING, ANYTHING])),
        () => notN(randomAtom(), pick([1, 2, 3])),
      ],
      [
        () => or(...twoAtoms()),
        () => not(or(...twoAtoms())),
        () => or(not(randomAtom()), randomAtom()),
      ],
      [
        () => memory(),
        () => not(memory()),
        () => or(memory(), randomAtom()),
        () => not(or(memory(), randomAtom())),
      ],
      // Shuffle level: short prompts, since re-reading the pad is the challenge.
      [() => randomAtom(), () => not(randomAtom()), () => or(...twoAtoms())],
      [() => missingSame(), () => missingSame(), () => missingMixed()],
      [
        () => or(not(randomAtom()), not(randomAtom())),
        () => notN(or(...twoAtoms()), 2),
      ],
      [() => notN(randomAtom(), pick([2, 3, 4])), () => or(notN(randomAtom(), 2), not(randomAtom()))],
      // Fade level: mid-length prompts, since remembering them is the challenge.
      [() => not(or(...twoAtoms())), () => or(not(randomAtom()), randomAtom()), () => notN(randomAtom(), 3), () => missingSame()],
      [
        () => missingMixed(),
        () => notN(or(...twoAtoms()), 3),
        () => not(or(notN(randomAtom(), 2), randomAtom())),
        () => notN(or(memory(), randomAtom()), 2),
      ],
      [
        () => missingMixed(),
        () => notN(or(not(randomAtom()), randomAtom()), pick([1, 2, 3])),
        () => notN(or(...twoAtoms()), 3),
        () => not(or(notN(randomAtom(), 2), randomAtom())),
      ],
    ];

    const RECENT_FORMATS = 2;
    let last = '';
    let recentFormats = [];
    return function next(level, { lastKey: previousKey = null } = {}) {
      recentKey = previousKey;
      for (let attempt = 0; attempt < 50; attempt++) {
        // Favor the newest rule, but keep mixing in everything learned so far.
        // Later levels lean less on the newest rule, so the hardest prompts stay occasional.
        const newest = level >= 6 ? 0.4 : 0.6;
        const tier = rng() < newest ? level : Math.floor(rng() * (level + 1));
        let expr;
        try { expr = pick(TEMPLATES[tier])(); } catch (err) { if (err === NO_MEMORY) continue; throw err; }
        const text = toText(expr);
        const answers = evaluate(expr);
        // "Press nothing" only comes from prompts that say nothing outright, never from a contradiction.
        const accidentalNothing = answers.size === 0 && !mentionsNothing(expr);
        // Compound formats can't repeat within the last few prompts, so the mix feels random.
        const format = formatOf(expr);
        const repeatsFormat = format !== 'x' && recentFormats.includes(format);
        if (text === last || accidentalNothing || hasPointlessOr(expr) || repeatsFormat) continue;
        last = text;
        recentFormats = [format, ...recentFormats].slice(0, RECENT_FORMATS);
        return expr;
      }
      last = '';
      recentFormats = ['x', ...recentFormats].slice(0, RECENT_FORMATS);
      return randomAtom();
    };
  }

  const api = {
    KEYS, ALL_IDS, COLORS, LEVELS, featureLevel, resetLayout, shuffleLayout,
    atom, not, or, and, missing, lastKey, ANYTHING, NOTHING,
    evaluate, hasPointlessOr, formatOf, toTokens, toText, opCount, levelFor, timeLimit, makeRng, createGenerator,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NotNot = api;
})(this);
