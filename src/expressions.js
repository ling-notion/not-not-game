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
  // "red and blue" means press both keys (in any order); each item names exactly one key.
  const all = (items) => ({ type: 'all', items });
  const needsAll = (e) => e.type === 'all';
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
      case 'all':
        return new Set(e.items.flatMap((item) => [...evaluate(item)]));
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

  const PRECEDENCE = { missing: 0, all: 0, or: 1, and: 2, not: 3, atom: 4 };

  // Flattens an expression into display tokens, adding parentheses only where precedence needs them.
  function toTokens(e, parentPrec = 0) {
    const prec = PRECEDENCE[e.type];
    let tokens;
    if (e.type === 'atom') tokens = [{ kind: 'atom', text: e.value, atom: e }];
    else if (e.type === 'all') {
      tokens = e.items.flatMap((item, i) => [...(i ? [{ kind: 'op', text: 'and' }] : []), ...toTokens(item, PRECEDENCE.or)]);
    } else if (e.type === 'missing') tokens = [{ kind: 'op', text: 'missing:' }, ...e.items.flatMap((item) => toTokens(item))];
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
    if (e.type === 'all') return e.items.length - 1 + e.items.reduce((n, item) => n + opCount(item), 0);
    return 1 + opCount(e.a) + opCount(e.b);
  }

  // Seconds of play at which each level begins, and the rule each level introduces.
  // Ordered easiest to hardest. Each level unlocks one mechanic; `cap` is the most difficult
  // prompt (see difficulty()) that level may show, so heavy combinations only arrive late.
  const LEVELS = [
    { id: 'basic', at: 0, cap: 0.5, intro: 'Press the key that matches' },
    { id: 'not', at: 6, cap: 1.5, intro: 'New: "not" means anything except' },
    { id: 'nothing', at: 15, cap: 2, intro: 'New: "nothing" means don\'t press' },
    { id: 'symbols', at: 26, cap: 2.5, intro: 'New: symbols instead of words' },
    { id: 'or', at: 38, cap: 3, intro: 'New: "or"' },
    { id: 'and', at: 50, cap: 3.5, intro: 'New: "and" means press every key named' },
    { id: 'lyingColors', at: 64, cap: 4, intro: 'New: words lie about their color' },
    { id: 'memory', at: 78, cap: 4.5, intro: 'New: "last key" means the key you just pressed' },
    { id: 'shuffle', at: 92, cap: 5, intro: 'New: the colors and shapes swap keys' },
    { id: 'missing', at: 106, cap: 5.5, intro: 'New: press the one that\'s missing' },
    { id: 'chaos', at: 124, cap: 7, intro: 'Chaos mode' },
    { id: 'endless', at: 150, cap: 8.5, intro: 'Endless: it only gets faster' },
  ];

  // Index of the level with this id, e.g. featureLevel('shuffle').
  const featureLevel = (id) => LEVELS.findIndex((l) => l.id === id);

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
    const base = [2300, 2150, 2000, 1900, 1850, 1850, 1850, 1800, 1800, 1750, 1700, 1650][level];
    const decay = Math.max(0, seconds - LEVELS[level].at) * 4;
    // Each extra key an "and" prompt needs gets time for another press.
    const extraPresses = needsAll(expr) ? (expr.items.length - 1) * 420 : 0;
    return Math.max(1150, base - decay) + opCount(expr) * 260 + extraPresses;
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
    if (expr.type === 'missing' || expr.type === 'all') return false;
    return mentionsNothing(expr.a) || mentionsNothing(expr.b);
  }

  const isSubset = (a, b) => [...a].every((id) => b.has(id));

  // An "or" is pointless when one side adds nothing ("yellow or star") or together they cover
  // every key ("not down or down"); such prompts read as tricks rather than real statements.
  function hasPointlessOr(expr) {
    if (expr.type === 'atom') return false;
    if (expr.type === 'not') return hasPointlessOr(expr.e);
    if (expr.type === 'missing' || expr.type === 'all') return false;
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

  // How hard each mechanic is to process; a prompt's difficulty is the sum of what it uses.
  const STYLE_MECHANICS_LIST = ['symbols', 'lyingColors'];
  const WEIGHTS = {
    word: 0.5, nothing: 1, memory: 2, not: 1, or: 1.5,
    missing: 5, missingMixed: 1.5, and2: 2.5, and3: 4.5,
    symbols: 0.75, lyingColors: 1.5,
  };

  // Adds each mechanic's weight to `parts` as [name, weight] pairs.
  function scoreExpr(e, parts) {
    switch (e.type) {
      case 'atom':
        if (e.attr === 'none' || e.attr === 'any') parts.push([e.value, WEIGHTS.nothing]);
        else if (e.attr === 'last') parts.push(['last key', WEIGHTS.memory]);
        else parts.push(['word', WEIGHTS.word]);
        return;
      case 'not': parts.push(['not', WEIGHTS.not]); scoreExpr(e.e, parts); return;
      case 'or': parts.push(['or', WEIGHTS.or]); scoreExpr(e.a, parts); scoreExpr(e.b, parts); return;
      case 'missing':
        parts.push(['missing', WEIGHTS.missing]);
        if (new Set(e.items.map((item) => item.attr)).size > 1) parts.push(['mixed attributes', WEIGHTS.missingMixed]);
        return;
      case 'all': {
        parts.push([`and (${e.items.length} keys)`, e.items.length === 2 ? WEIGHTS.and2 : WEIGHTS.and3]);
        // Items cost only what they add beyond a plain word, e.g. "not not red" or "last key".
        e.items.forEach((item) => {
          const inner = [];
          scoreExpr(item, inner);
          inner.filter(([name]) => name !== 'word').forEach((p) => parts.push(p));
          if (!inner.some(([name]) => name === 'word')) parts.push(['word', -WEIGHTS.word]);
        });
        return;
      }
      default:
    }
  }

  // Each mechanic a prompt uses with its weight, including display style; sums to difficulty().
  function difficultyParts(expr) {
    const parts = [];
    scoreExpr(expr, parts);
    const style = expr.style || {};
    STYLE_MECHANICS_LIST.forEach((m) => { if (style[m]) parts.push([m, WEIGHTS[m]]); });
    return parts;
  }

  // Total difficulty of a prompt, including how it's displayed (symbols, lying colors).
  function difficulty(expr) {
    return difficultyParts(expr).reduce((n, [, w]) => n + w, 0);
  }

  // Which logic mechanics a prompt uses, so a newly unlocked one can be featured.
  function mechanicsOf(e, found = new Set()) {
    if (e.type === 'atom') {
      if (e.attr === 'none' || e.attr === 'any') found.add('nothing');
      if (e.attr === 'last') found.add('memory');
    } else if (e.type === 'not') {
      found.add('not');
      mechanicsOf(e.e, found);
    } else if (e.type === 'or') {
      found.add('or');
      mechanicsOf(e.a, found);
      mechanicsOf(e.b, found);
    } else if (e.type === 'missing') found.add('missing');
    else if (e.type === 'all') {
      found.add('and');
      e.items.forEach((item) => mechanicsOf(item, found));
    }
    return found;
  }

  const STYLE_MECHANICS = ['symbols', 'lyingColors'];
  const LOGIC_MECHANICS = ['not', 'nothing', 'or', 'and', 'missing', 'memory'];

  function createGenerator(rng = Math.random) {
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const weighted = (options) => {
      const total = options.reduce((n, [, w]) => n + w, 0);
      let r = rng() * total;
      for (const [value, w] of options) if ((r -= w) < 0) return value;
      return options[options.length - 1][0];
    };
    const randomAtom = (attr = pick(ATTRS)) => atom(attr, pick(KEYS)[attr]);
    const notN = (e, n) => (n === 0 ? e : not(notN(e, n - 1)));
    const shuffled = (arr) => [...arr].sort(() => rng() - 0.5);
    let recentKey = null;

    // Builds a random logic expression from the unlocked mechanics, shallower as it nests.
    // Higher caps nest deeper, so late levels can actually reach their harder prompts.
    function build(has, cap, depth = 0) {
      const leafChance = Math.max(0.12, (depth === 0 ? 0.4 : depth === 1 ? 0.6 : 0.8) - cap * 0.03);
      const nodes = [];
      if (has('not')) nodes.push(['not', 3]);
      if (has('or')) nodes.push(['or', 2]);
      if (!nodes.length || depth >= 3 || rng() < leafChance) {
        return recentKey && has('memory') && rng() < 0.2 ? lastKey(recentKey) : randomAtom();
      }
      const node = weighted(nodes);
      if (node === 'not') return not(build(has, cap, depth + 1));
      return or(build(has, cap, depth + 1), build(has, cap, depth + 1));
    }

    // One-key items for "and" prompts: words, double negations, or the last key.
    function andPrompt(has) {
      const count = rng() < 0.65 ? 2 : 3;
      const items = shuffled(KEYS).slice(0, count).map((k) => {
        const roll = rng();
        if (recentKey === k.id && has('memory') && roll < 0.25) return lastKey(k.id);
        const word = randomAtom();
        const base = atom(word.attr, k[word.attr]);
        return has('not') && roll > 0.8 ? notN(base, 2) : base;
      });
      return all(items);
    }

    function missingPrompt() {
      const keys = shuffled(KEYS).slice(0, 3);
      const sameAttr = rng() < 0.6 ? pick(ATTRS) : null;
      return missing(keys.map((k) => { const attr = sameAttr || pick(ATTRS); return atom(attr, k[attr]); }));
    }

    function candidate(has, cap) {
      const shapes = [['logic', 6]];
      if (has('and')) shapes.push(['and', 1.5]);
      if (has('missing')) shapes.push(['missing', 1.2]);
      if (has('nothing')) shapes.push(['nothing', 0.8]);
      const shape = weighted(shapes);
      if (shape === 'and') return andPrompt(has);
      if (shape === 'missing') return missingPrompt();
      if (shape === 'nothing') return notN(pick([NOTHING, ANYTHING]), pick([0, 0, 1, 2]));
      return build(has, cap);
    }

    const RECENT_FORMATS = 2;
    let last = '';
    let recentFormats = [];
    let recentAnswers = []; // answer sets of the last two prompts, e.g. "down"
    let lastWords = new Set(); // words used by the previous prompt
    const wordsOf = (expr) => new Set(toTokens(expr).filter((t) => t.atom && t.atom.attr !== 'last').map((t) => t.atom.value));
    return function next(level, { lastKey: previousKey = null } = {}) {
      recentKey = previousKey;
      const unlocked = new Set(LEVELS.slice(0, level + 1).map((l) => l.id));
      const has = (id) => unlocked.has(id);
      const { cap, id: newest } = LEVELS[level];
      // Half the prompts at a level feature its new mechanic, so every mechanic gets tried.
      const featurable = LOGIC_MECHANICS.includes(newest) || STYLE_MECHANICS.includes(newest);
      const feature = featurable && rng() < 0.5 ? newest : null;
      for (let attempt = 0; attempt < 300; attempt++) {
        const expr = candidate(has, cap);
        const style = {};
        STYLE_MECHANICS.forEach((m) => {
          if (has(m)) style[m] = m === feature || rng() < 0.4;
        });
        if (style.symbols && !toTokens(expr).some((t) => t.atom && (t.atom.attr === 'dir' || t.atom.attr === 'shape'))) {
          style.symbols = false;
        }
        expr.style = style;

        const score = difficulty(expr);
        if (score > cap) continue;
        // Aim near the level's cap, but easy prompts still slip in now and then.
        if (score < cap * 0.6 && rng() > 0.3) continue;
        // The feature is a preference: drop it if other rules (e.g. no repeated formats) block it.
        if (attempt < 100 && feature && LOGIC_MECHANICS.includes(feature) && !mechanicsOf(expr).has(feature)) continue;

        const text = toText(expr);
        const answers = evaluate(expr);
        // "Press nothing" only comes from prompts that say nothing outright, never from a contradiction.
        const accidentalNothing = answers.size === 0 && !mentionsNothing(expr);
        // Compound formats can't repeat within the last few prompts, so the mix feels random.
        const format = formatOf(expr);
        const repeatsFormat = format !== 'x' && recentFormats.includes(format);
        // The same answer can't come three times running, and back-to-back prompts share no words.
        const answerKey = [...answers].sort().join(',');
        const repeatsAnswer = recentAnswers.length === 2 && recentAnswers.every((a) => a === answerKey);
        const words = wordsOf(expr);
        const reusesWord = [...words].some((w) => lastWords.has(w));
        if (text === last || accidentalNothing || hasPointlessOr(expr) || repeatsFormat || repeatsAnswer || reusesWord) continue;
        last = text;
        recentFormats = [format, ...recentFormats].slice(0, RECENT_FORMATS);
        recentAnswers = [answerKey, ...recentAnswers].slice(0, 2);
        lastWords = words;
        return expr;
      }
      last = '';
      recentFormats = ['x', ...recentFormats].slice(0, RECENT_FORMATS);
      const answerOf = (e) => [...evaluate(e)].sort().join(',');
      let fallback = randomAtom();
      while (lastWords.has(fallback.value) || (recentAnswers.length === 2 && recentAnswers.every((a) => a === answerOf(fallback)))) {
        fallback = randomAtom();
      }
      lastWords = new Set([fallback.value]);
      recentAnswers = [answerOf(fallback), ...recentAnswers].slice(0, 2);
      fallback.style = {};
      return fallback;
    };
  }

  const api = {
    KEYS, ALL_IDS, COLORS, LEVELS, featureLevel, resetLayout, shuffleLayout,
    atom, not, or, and, all, missing, lastKey, needsAll, difficulty, difficultyParts, mechanicsOf, ANYTHING, NOTHING,
    evaluate, hasPointlessOr, formatOf, toTokens, toText, opCount, levelFor, timeLimit, makeRng, createGenerator,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NotNot = api;
})(this);
