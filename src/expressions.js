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
  // The keys that satisfy each part of an "and" prompt; each part needs its own pressed key.
  const andSlots = (e) => e.items.map((item) => evaluate(item));
  // True when every pressed key can stand for a different part ("red and not blue": red plus one non-blue).
  function canFill(slots, pressed, used = new Set()) {
    const keys = [...pressed];
    if (keys.length > slots.length) return false;
    const assign = (i) => {
      if (i === keys.length) return true;
      for (let s = 0; s < slots.length; s++) {
        if (used.has(s) || !slots[s].has(keys[i])) continue;
        used.add(s);
        if (assign(i + 1)) return true;
        used.delete(s);
      }
      return false;
    };
    return assign(0);
  }
  // True when some set of distinct keys fills every part.
  function solvable(slots, i = 0, taken = new Set()) {
    if (i === slots.length) return true;
    return [...slots[i]].some((id) => {
      if (taken.has(id)) return false;
      taken.add(id);
      const ok = solvable(slots, i + 1, taken);
      taken.delete(id);
      return ok;
    });
  }
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
    } else if (e.type === 'missing') {
      // Commas keep multi-word items like "not not star" readable as one item.
      tokens = [{ kind: 'op', text: 'missing:' }, ...e.items.flatMap((item, i) => [...(i ? [{ kind: 'comma', text: ',' }] : []), ...toTokens(item)])];
    }
    else if (e.type === 'not') tokens = [{ kind: 'op', text: 'not' }, ...toTokens(e.e, prec)];
    else tokens = [...toTokens(e.a, prec), { kind: 'op', text: e.type }, ...toTokens(e.b, prec + 1)];
    if (prec < parentPrec) tokens = [{ kind: 'paren', text: '(' }, ...tokens, { kind: 'paren', text: ')' }];
    return tokens;
  }

  const toText = (e) => toTokens(e).map((t) => t.text).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ,/g, ',');

  function opCount(e) {
    if (e.type === 'atom') return 0;
    if (e.type === 'not') return 1 + opCount(e.e);
    if (e.type === 'missing') return e.items.length - 1 + e.items.reduce((n, item) => n + opCount(item), 0);
    if (e.type === 'all') return e.items.length - 1 + e.items.reduce((n, item) => n + opCount(item), 0);
    return 1 + opCount(e.a) + opCount(e.b);
  }

  // Seconds of play at which each level begins, and the rule each level introduces.
  // Ordered easiest to hardest. Each level unlocks one mechanic; how hard prompts get is set
  // separately by the smooth targetDifficulty() curve, so unlocking never causes a jump.
  const LEVELS = [
    { id: 'basic', at: 0, intro: 'Press the key that matches' },
    { id: 'not', at: 6, intro: 'New: "not" means anything except' },
    { id: 'nothing', at: 15, intro: 'New: "nothing" means don\'t press' },
    { id: 'symbols', at: 26, intro: 'New: symbols instead of words' },
    { id: 'or', at: 38, intro: 'New: "or"' },
    { id: 'and', at: 50, intro: 'New: "and" means press every key named' },
    { id: 'lyingColors', at: 64, intro: 'New: words lie about their color' },
    { id: 'memory', at: 78, intro: 'New: "last key" means the key you just pressed' },
    { id: 'shuffle', at: 92, intro: 'New: the colors and shapes swap keys' },
    { id: 'chaos', at: 108, intro: 'Chaos mode' },
    { id: 'missing', at: 128, intro: 'New: press the one that\'s missing' },
    { id: 'endless', at: 154, intro: 'Endless: it only gets faster' },
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
  // Answer window in ms: the base shrinks smoothly over time, and harder prompts get reading time.
  function timeLimit(level, seconds, expr) {
    const base = 1200 + 1100 * Math.exp(-seconds / 160);
    // Reading-time help shrinks as the game goes on, so later prompts keep getting tighter overall.
    const reading = 230 * (0.55 + 0.45 * Math.exp(-seconds / 150));
    // Each extra key an "and" prompt needs gets time for another press.
    const extraPresses = needsAll(expr) ? (expr.items.length - 1) * 420 : 0;
    // Once chaos mode begins, every window tightens gradually over 90s, to at most 10% shorter.
    const chaosAt = LEVELS.find((l) => l.id === 'chaos').at;
    const squeeze = 1 - 0.1 * Math.min(1, Math.max(0, seconds - chaosAt) / 90);
    return Math.round((base + Math.max(0, difficulty(expr) - 0.5) * reading + extraPresses) * squeeze);
  }

  // The typical prompt difficulty at a point in the game: rises quickly at first, then keeps
  // climbing steadily until MAX_DIFFICULTY. Individual prompts vary around it.
  const MAX_DIFFICULTY = 12;
  function targetDifficulty(seconds) {
    const curve = 0.5 + 5 * (1 - Math.exp(-seconds / 110)) + 0.014 * Math.max(0, seconds - 150);
    return Math.min(MAX_DIFFICULTY, curve);
  }

  // Seconds a newly unlocked mechanic stays "new": it's featured, but in simple prompts.
  const INTRO_SECONDS = 14;

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
    // "or" makes prompts easier: more keys count as right.
    word: 0.5, nothing: 1, memory: 2, not: 1, or: -0.5,
    stacked: 0.3, notGroup: 2.5, stackedGroup: 0.6, nestedGroup: 1,
    missing: 6, missingMixed: 2, and2: 2.5, and3: 4.5, andChoice: 2,
    symbols: 0.75, lyingColors: 1.5,
  };

  // Adds each mechanic's weight to `parts` as [name, weight] pairs.
  // `inGroup` marks being inside a negated group, where another group is extra hard to track.
  function scoreExpr(e, parts, inGroup = false) {
    switch (e.type) {
      case 'atom':
        if (e.attr === 'none' || e.attr === 'any') parts.push([e.value, WEIGHTS.nothing]);
        else if (e.attr === 'last') parts.push(['last key', WEIGHTS.memory]);
        else parts.push(['word', WEIGHTS.word]);
        return;
      case 'not': {
        // Stacked nots are cheap on their own; negating a compound like "(x or y)" is what's hard.
        let depth = 0;
        let inner = e;
        while (inner.type === 'not') { depth += 1; inner = inner.e; }
        const compound = inner.type !== 'atom';
        parts.push([compound ? 'not (group)' : 'not', compound ? WEIGHTS.notGroup : WEIGHTS.not]);
        if (compound && inGroup) parts.push(['nested group', WEIGHTS.nestedGroup]);
        if (depth > 1) parts.push([`stacked not ×${depth - 1}`, (depth - 1) * (compound ? WEIGHTS.stackedGroup : WEIGHTS.stacked)]);
        scoreExpr(inner, parts, inGroup || compound);
        return;
      }
      case 'or': parts.push(['or', WEIGHTS.or]); scoreExpr(e.a, parts, inGroup); scoreExpr(e.b, parts, inGroup); return;
      case 'missing':
      case 'all': {
        if (e.type === 'missing') {
          parts.push(['missing', WEIGHTS.missing]);
          const attrs = new Set(e.items.map((item) => (item.type === 'atom' ? item.attr : 'compound')));
          if (attrs.size > 1) parts.push(['mixed attributes', WEIGHTS.missingMixed]);
        } else {
          parts.push([`and (${e.items.length} keys)`, e.items.length === 2 ? WEIGHTS.and2 : WEIGHTS.and3]);
        }
        // Items cost only what they add beyond a plain word, e.g. "not not red" or "last key".
        // An item with several right keys ("not yellow") means choosing one, which costs like an extra key.
        e.items.forEach((item) => {
          if (e.type === 'all' && evaluate(item).size > 1) parts.push(['choice in and', WEIGHTS.andChoice]);
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
    return Math.max(WEIGHTS.word, difficultyParts(expr).reduce((n, [, w]) => n + w, 0));
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

  // True when a "not" directly wraps another "not", as in "not not red".
  function hasStackedNot(e) {
    if (e.type === 'not') return e.e.type === 'not' || hasStackedNot(e.e);
    if (e.type === 'or' || e.type === 'and') return hasStackedNot(e.a) || hasStackedNot(e.b);
    if (e.type === 'all' || e.type === 'missing') return e.items.some(hasStackedNot);
    return false;
  }

  const STYLE_MECHANICS = ['symbols', 'lyingColors'];
  // The cheapest prompt that shows a mechanic, e.g. "not red" for not.
  const introCost = (id) => ({
    not: WEIGHTS.not + WEIGHTS.word, nothing: WEIGHTS.nothing, or: WEIGHTS.or + 2 * WEIGHTS.word,
    and: WEIGHTS.and2, missing: WEIGHTS.missing, memory: WEIGHTS.memory,
    symbols: WEIGHTS.symbols + WEIGHTS.word, lyingColors: WEIGHTS.lyingColors + WEIGHTS.word,
  })[id] || 1;
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
    // `inOr` stops an "or" directly inside another, which reads as a near-anything list.
    function build(has, cap, depth = 0, inOr = false) {
      const leafChance = Math.max(0.12, (depth === 0 ? 0.4 : depth === 1 ? 0.6 : 0.8) - cap * 0.03);
      const nodes = [];
      if (has('not')) nodes.push(['not', 3]);
      if (has('or') && !inOr) nodes.push(['or', 2]);
      if (!nodes.length || depth >= 3 || rng() < leafChance) {
        return recentKey && has('memory') && rng() < 0.2 ? lastKey(recentKey) : randomAtom();
      }
      const node = weighted(nodes);
      if (node === 'not') return not(build(has, cap, depth + 1));
      return or(build(has, cap, depth + 1, true), build(has, cap, depth + 1, true));
    }

    // Items for "and" prompts: words, double negations, the last key, or (late) a choice like
    // "not yellow", where any key but yellow works as long as it isn't already used by another part.
    function andPrompt(has) {
      const count = rng() < 0.65 ? 2 : 3;
      const choiceChance = has('not') ? (has('endless') ? 0.15 : has('chaos') ? 0.08 : 0) : 0;
      for (let tries = 0; tries < 10; tries++) {
        const keys = shuffled(KEYS).slice(0, count);
        let choices = 0;
        const items = keys.map((k) => {
          const roll = rng();
          if (recentKey === k.id && has('memory') && roll < 0.25) return lastKey(k.id);
          const word = randomAtom();
          const base = atom(word.attr, k[word.attr]);
          // At most one choice per prompt, and it never negates a key another part names.
          if (!choices && rng() < choiceChance) {
            const other = shuffled(KEYS).find((o) => !keys.includes(o));
            if (other) { choices += 1; const attr = pick(ATTRS); return not(atom(attr, other[attr])); }
          }
          // Endless doubles the negation chance, for heavier "and" prompts.
          return has('not') && roll > (has('endless') ? 0.6 : 0.8) ? notN(base, 2) : base;
        });
        const e = all(items);
        if (solvable(andSlots(e))) return e;
      }
      return all(shuffled(KEYS).slice(0, 2).map((k) => atom('color', k.color)));
    }

    // In endless, items can be compound ("not not star", "last key") for heavier prompts.
    function missingPrompt(has) {
      const keys = shuffled(KEYS).slice(0, 3);
      const sameAttr = rng() < 0.6 ? pick(ATTRS) : null;
      const compound = has('endless') ? 0.3 : 0;
      return missing(keys.map((k) => {
        const attr = sameAttr || pick(ATTRS);
        const item = atom(attr, k[attr]);
        if (rng() >= compound) return item;
        return recentKey === k.id && has('memory') && rng() < 0.4 ? lastKey(k.id) : notN(item, 2);
      }));
    }

    // Negated groups, nested two or three deep: "not (red or not (up or star))". Parentheses are
    // what's hard to parse, so late prompts lean on these rather than piling on more nots.
    function groupPrompt(has, cap, depth = 0, used = new Set()) {
      const maxDepth = cap >= 10 ? 2 : 1;
      const freshAtom = () => {
        let a = randomAtom();
        for (let i = 0; i < 10 && used.has(a.value); i++) a = randomAtom();
        used.add(a.value);
        return a;
      };
      const side = () => {
        const r = rng();
        if (depth < maxDepth && r < (cap >= 11 ? 0.6 : 0.4)) return groupPrompt(has, cap, depth + 1, used);
        if (recentKey && has('memory') && !used.has('last key') && r < 0.48) { used.add('last key'); return lastKey(recentKey); }
        return r < 0.8 ? freshAtom() : not(freshAtom());
      };
      return notN(or(side(), side()), rng() < 0.8 ? 1 : 2);
    }

    function candidate(has, cap) {
      const shapes = [['logic', 6]];
      // Groups take a bigger share as prompts get harder in the late game.
      if (has('chaos') && has('or')) shapes.push(['group', cap >= 9 ? 8 : cap >= 7 ? 5 : cap >= 5 ? 2 : 0.5]);
      if (has('and')) shapes.push(['and', 1.5]);
      if (has('missing')) shapes.push(['missing', has('endless') && cap >= 11 ? 0.35 : has('endless') && cap >= 9 ? 0.6 : 1.2]);
      if (has('nothing')) shapes.push(['nothing', 0.8]);
      const shape = weighted(shapes);
      if (shape === 'and') return andPrompt(has);
      if (shape === 'missing') return missingPrompt(has);
      if (shape === 'group') {
        // Group scores vary widely, so try a few and keep the one closest to the aim (cap - 1).
        let best = null;
        for (let i = 0; i < 12; i++) {
          const g = groupPrompt(has, cap);
          if (!best || Math.abs(difficulty(g) - (cap - 1)) < Math.abs(difficulty(best) - (cap - 1))) best = g;
          if (Math.abs(difficulty(best) - (cap - 1)) <= 0.3) break;
        }
        return best;
      }
      if (shape === 'nothing') return notN(pick([NOTHING, ANYTHING]), pick([0, 0, 1, 2]));
      return build(has, cap);
    }

    const RECENT_FORMATS = 2;
    let last = '';
    let recentFormats = [];
    let recentAnswers = []; // answer sets of the last two prompts, e.g. "down"
    let lastWords = new Set(); // words used by the previous prompt
    let lastScore = null; // difficulty of the previous prompt, so no prompt jumps far above it
    const wordsOf = (expr) => new Set(toTokens(expr).filter((t) => t.atom && t.atom.attr !== 'last').map((t) => t.atom.value));
    // stackedNots: false holds back "not not ..." until the player has met a single "not".
    // target overrides the time curve; spiky lets some prompts jump well above it.
    return function next(level, { lastKey: previousKey = null, seconds = LEVELS[level].at + 8, skill = 0, stackedNots = true, target: fixedTarget = null, spiky = false } = {}) {
      recentKey = previousKey;
      const unlocked = new Set(LEVELS.slice(0, level + 1).map((l) => l.id));
      const has = (id) => unlocked.has(id);
      const target = Math.max(0.5, (fixedTarget ?? targetDifficulty(seconds)) + skill);
      // Each prompt aims at its own point near the target: mostly just under it, with some breathers.
      // Spiky runs swap a share of those for spikes well above the target.
      const roll = rng();
      const aim = Math.max(0.5, roll < 0.15 ? target - 1.2 : spiky && roll > 0.8 ? target + 0.8 + rng() * 0.8 : target - 0.5 + rng() * 0.8);
      // Hard cap: a little above the target, and at most one step above the previous prompt.
      // A breather or fallback lowers it only briefly, since the floor tracks the target.
      const cap = spiky ? target + 1.7 : Math.min(target + 0.7, lastScore == null ? Infinity : Math.max(lastScore, target - 1, 0.5) + 1.2);
      // Mechanics above the cap wait until the curve catches up, instead of spiking in early.
      const affordable = (m) => introCost(m) <= cap;
      // A mechanic unlocked moments ago is shown often but on its own, in a simple prompt.
      const { id: latest, at } = LEVELS[level];
      const isNew = seconds - at < INTRO_SECONDS && (LOGIC_MECHANICS.includes(latest) || STYLE_MECHANICS.includes(latest)) && affordable(latest);
      // Occasionally refresh an earlier mechanic in a simple standalone prompt, so heavy ones
      // (like "missing") keep appearing before the curve is high enough to include them.
      // Only rules whose simplest prompt sits near the target, so a refresher never reads as a sudden dip.
      const refreshable = LOGIC_MECHANICS.filter((m) => has(m) && affordable(m) && introCost(m) >= target - 2);
      // Heavier mechanics are refreshed more often, since the curve rarely reaches them on its own.
      const refresh = !isNew && refreshable.length && rng() < 0.07 ? weighted(refreshable.map((m) => [m, introCost(m)])) : null;
      const newest = refresh || latest;
      const introduceFirst = refresh ? true : isNew && rng() < 0.6;
      for (let attempt = 0; attempt < 300; attempt++) {
        // An introduction is a preference: other rules (like no repeated formats) can block it.
        const introduce = introduceFirst && attempt < 100;
        const easier = Math.max(0, attempt - (introduceFirst ? 100 : 0)) / 50;
        const expr = candidate(has, aim + 1);
        const style = {};
        STYLE_MECHANICS.forEach((m) => {
          if (has(m)) style[m] = (introduce && m === newest) || (!introduce && rng() < 0.4);
        });
        if (style.symbols && !toTokens(expr).some((t) => t.atom && (t.atom.attr === 'dir' || t.atom.attr === 'shape'))) {
          style.symbols = false;
        }
        expr.style = style;
        const score = difficulty(expr);
        // Never above the cap; if attempts keep failing, accept easier prompts.
        if (score > cap + (introduce ? 0.3 : 0)) continue;
        if (introduce) {
          const logic = LOGIC_MECHANICS.includes(newest);
          if (logic && !mechanicsOf(expr).has(newest)) continue;
          if (!logic && !style[newest]) continue;
          // Introductions keep everything else minimal: the new mechanic plus at most a little.
          if (score > introCost(newest) + 1) continue;
        } else if (score > aim + 0.4 || score < aim - 0.6 - easier) continue;
        expr.aim = introduce ? null : aim;
        expr.target = target;

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
        if (!stackedNots && hasStackedNot(expr)) continue;
        if (text === last || accidentalNothing || hasPointlessOr(expr) || repeatsFormat || repeatsAnswer || reusesWord) continue;
        last = text;
        recentFormats = [format, ...recentFormats].slice(0, RECENT_FORMATS);
        recentAnswers = [answerKey, ...recentAnswers].slice(0, 2);
        lastWords = words;
        lastScore = score;
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
      fallback.target = target;
      fallback.aim = aim;
      lastScore = difficulty(fallback);
      return fallback;
    };
  }

  const api = {
    KEYS, ALL_IDS, COLORS, LEVELS, featureLevel, resetLayout, shuffleLayout,
    atom, not, or, and, all, missing, lastKey, needsAll, difficulty, difficultyParts, mechanicsOf, hasStackedNot, andSlots, canFill, ANYTHING, NOTHING,
    evaluate, hasPointlessOr, formatOf, targetDifficulty, toTokens, toText, opCount, levelFor, timeLimit, makeRng, createGenerator,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NotNot = api;
})(this);
