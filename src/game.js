// Game loop, input handling, and rendering. Depends on window.NotNot and window.Sound.
(function () {
  'use strict';
  const { KEYS, COLORS, atom, not, or, all, missing, lastKey, NOTHING, ANYTHING, mechanicsOf, hasStackedNot, LEVELS, featureLevel, resetLayout, shuffleLayout, needsAll, difficulty, difficultyParts, targetDifficulty, evaluate, toTokens, toText, opCount, levelFor, timeLimit, createGenerator } = window.NotNot;

  const HEX = { red: '#ff5a5f', green: '#3ddc84', blue: '#4da3ff', yellow: '#ffd23f' };
  const START_LIVES = 3;
  const BEST_KEY = 'not-not-best';
  const HARD_KEY = 'not-not-hard';
  // Hard mode runs the difficulty clock faster, trims every answer window, and aims prompts
  // a little above the normal curve.
  // It also starts a minute into the game, skipping the warm-up levels.
  const HARD = { clock: 1.6, time: 0.85, boost: 0.8, start: 60 };
  // Normal mode's difficulty clock runs a little fast, since each new mechanic gets an intro card.
  const NORMAL_CLOCK = 1.2;
  // Each mechanic is explained once per player, the first time a game reaches it.
  const SEEN_KEY = 'not-not-seen';
  const LEVEL_CARDS = ['shuffle', 'chaos', 'endless'];
  const c = (color) => atom('color', color);
  const INTROS = {
    basic: { title: 'Press the key that matches', body: 'Each arrow key has a direction, a color, and a shape. Press the one the text names.', expr: c('green') },
    not: { title: '"not" flips it', body: 'Press any key except the one named.', expr: not(c('red')) },
    stacked: { title: 'Nots cancel out', body: 'Each "not" flips everything after it, so two of them flip it back. Work out where you land.', expr: not(not(c('red'))) },
    nothing: { title: '"nothing" means wait', body: "Don't press anything. Let the timer run out.", expr: NOTHING },
    anything: { title: '"anything" means any key', body: 'Press any key at all, before the timer runs out.', expr: ANYTHING },
    symbols: { title: 'Symbols replace words', body: 'Arrows and shapes can appear as pictures instead of words.', expr: atom('shape', 'circle'), symbols: true },
    or: { title: '"or" gives you a choice', body: 'Either key works.', expr: or(c('red'), c('blue')) },
    and: { title: '"and" means press them all', body: 'Press every key named, in any order.', expr: all([c('red'), c('blue')]) },
    lyingColors: { title: 'Colors can lie', body: 'Go by what the text says, not the color it is written in. Here the word says green, so press green.', expr: c('green'), lying: true },
    memory: { title: '"last key" is the key you just pressed', body: 'Press the same key you answered with last round.', icon: '↺' },
    shuffle: { title: 'The keys shuffle', body: 'Every so often the colors and shapes swap keys. Check the pad before answering.', icon: '🔀' },
    chaos: { title: 'Chaos mode', body: 'Everything so far, mixed together and coming faster.', icon: '🌀' },
    missing: { title: '"missing" means the one not listed', body: 'Three keys are named. Press the fourth.', expr: missing([c('red'), c('green'), c('blue')]) },
    endless: { title: 'Endless', body: 'From here it keeps getting harder, for as long as you last.', icon: '♾️' },
  };
  const SHUFFLE = featureLevel('shuffle');
  const SHUFFLE_EVERY = 12; // rounds between pad shuffles once the shuffle level is reached
  const byCode = Object.fromEntries(KEYS.map((k) => [k.code, k]));

  const $ = (sel) => document.querySelector(sel);
  const els = {
    prompt: $('#prompt'),
    timer: $('#timer-bar'),
    lives: $('#lives'),
    score: $('#score'),
    streak: $('#streak'),
    level: $('#level'),
    banner: $('#banner'),
    combo: $('#combo'),
    feedback: $('#feedback'),
    title: $('#title-screen'),
    over: $('#over-screen'),
    paused: $('#pause-screen'),
    pauseBtn: $('#pause'),
    hudBest: $('#hud-best'),
    finalScore: $('#final-score'),
    best: $('#best-score'),
    mute: $('#mute'),
    hardBadge: $('#hard-badge'),
    hardToggles: [...document.querySelectorAll('.hard-toggle:not(#help-toggle)')],
    restart: $('#restart'),
    titleHint: $('#title-hint'),
    intro: $('#intro-screen'),
    introTag: $('#intro-tag'),
    introTitle: $('#intro-title'),
    introBody: $('#intro-body'),
    introExample: $('#intro-example'),
    pauseNote: $('#pause-note'),
    share: $('#share'),
    sharePreview: $('#share-preview'),
    shareStatus: $('#share-status'),
    tiles: Object.fromEntries(KEYS.map((k) => [k.id, document.querySelector(`[data-key="${k.id}"]`)])),
  };

  function shapeSvg(shape, fill, size = 36) {
    const s = size;
    const paths = {
      circle: `<circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.42}"/>`,
      square: `<rect x="${s * 0.1}" y="${s * 0.1}" width="${s * 0.8}" height="${s * 0.8}" rx="${s * 0.08}"/>`,
      triangle: `<polygon points="${s / 2},${s * 0.08} ${s * 0.94},${s * 0.9} ${s * 0.06},${s * 0.9}"/>`,
      star: `<polygon points="${starPoints(s)}"/>`,
    };
    return `<svg class="shape" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" fill="${fill}" aria-hidden="true">${paths[shape]}</svg>`;
  }

  function starPoints(s) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? s * 0.48 : s * 0.2;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(`${(s / 2 + r * Math.cos(a)).toFixed(1)},${(s / 2 + r * Math.sin(a) + s * 0.04).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  function renderLegend() {
    KEYS.forEach((k) => {
      els.tiles[k.id].innerHTML = `
        <span class="arrow">${k.glyph}</span>
        ${shapeSvg(k.shape, HEX[k.color], 34)}
        <span class="label">${k.color} ${k.shape}</span>`;
    });
  }

  // Pause card help: a mini pad of the four keys, and each example's answer drawn as shapes.
  function renderTitleCard() {
    const mini = (k, size) => `<span class="mini" style="--c:${HEX[k.color]}">${shapeSvg(k.shape, HEX[k.color], size)}</span>`;
    $('.legend').innerHTML = KEYS.map((k) => `
      <div class="legend-key" style="grid-area:${k.id}">
        <span class="arrow">${k.glyph}</span>${shapeSvg(k.shape, HEX[k.color], 26)}
        <span class="label">${k.color}<br>${k.shape}</span>
      </div>`).join('');
    document.querySelectorAll('.ex-keys[data-keys]').forEach((el) => {
      el.innerHTML = el.dataset.keys.split(' ').map((group) =>
        group.split('+').map((id) => mini(KEYS.find((k) => k.id === id), 18)).join('<span class="plus">+</span>')
      ).join('<span class="or">/</span>');
    });
  }

  const pickOther = (exclude) => {
    const options = COLORS.filter((c) => c !== exclude);
    return options[Math.floor(Math.random() * options.length)];
  };

  // The prompt's style (chosen and scored by the generator) adds visual traps:
  // symbols in place of words, and colors that lie about the word.
  function renderPrompt(expr) {
    const style = expr.style || {};
    const tokens = toTokens(expr);
    // With symbols on, about half the eligible words become symbols, and always at least one.
    const eligible = tokens.filter((t) => t.atom && (t.atom.attr === 'dir' || t.atom.attr === 'shape'));
    const asSymbol = new Set(style.symbols ? eligible.filter(() => Math.random() < 0.5) : []);
    if (style.symbols && !asSymbol.size && eligible.length) asSymbol.add(eligible[0]);
    const pieces = [];
    let openParens = '';
    tokens.forEach((t) => {
      // Parentheses attach to their neighbors so they never wrap onto a line by themselves.
      if (t.kind === 'paren' && t.text === '(') { openParens += '<span class="paren">(</span>'; return; }
      if (t.kind === 'paren') { pieces[pieces.length - 1] += '<span class="paren">)</span>'; return; }
      if (t.kind === 'comma') { pieces[pieces.length - 1] += '<span class="op">,</span>'; return; }
      pieces.push(openParens + renderToken(t, style, asSymbol.has(t)));
      openParens = '';
    });
    els.prompt.innerHTML = pieces.map((p) => `<span class="word">${p}</span>`).join(' ');
    els.prompt.classList.remove('pop');
    void els.prompt.offsetWidth;
    els.prompt.classList.add('pop');
  }

  // Until the lying-colors card has been read, only color words lie, so its first prompt is the one that shows it.
  const lieAnywhere = () => loadSeen().has('lyingColors');
  function renderToken(t, style, asSymbol) {
    if (t.kind !== 'atom') return `<span class="${t.kind}">${t.text}</span>`;
    const { attr, value } = t.atom;
    if (asSymbol && attr === 'dir') {
      const key = KEYS.find((k) => k.dir === value);
      return `<span class="atom symbol">${key.glyph}</span>`;
    }
    if (asSymbol && attr === 'shape') {
      const fill = style.lyingColors && lieAnywhere() ? HEX[pickOther(KEYS.find((k) => k.shape === value).color)] : '#e8e8ef';
      return `<span class="atom symbol">${shapeSvg(value, fill, 44)}</span>`;
    }
    let color = '#f4f4f8';
    if (style.lyingColors && attr === 'color') color = HEX[pickOther(value)];
    else if (style.lyingColors && lieAnywhere() && Math.random() < 0.4) color = HEX[pickOther()];
    return `<span class="atom" style="color:${color}">${t.text}</span>`;
  }

  let hard = false;
  try { hard = localStorage.getItem(HARD_KEY) === '1'; } catch (_) { /* storage unavailable */ }
  // Hard mode keeps its own best score so the two aren't compared directly.
  const bestKey = (isHard = hard) => (isHard ? `${BEST_KEY}-hard` : BEST_KEY);
  const loadBest = (isHard = hard) => {
    try { return Number(localStorage.getItem(bestKey(isHard))) || 0; } catch (_) { return 0; }
  };
  let best = loadBest();
  // Hard mode unlocks after one finished regular game; anyone with a score already counts.
  const UNLOCK_KEY = 'not-not-hard-unlocked';
  let hardUnlocked = false;
  try { hardUnlocked = localStorage.getItem(UNLOCK_KEY) === '1'; } catch (_) { /* storage unavailable */ }
  hardUnlocked = hardUnlocked || loadBest(false) > 0 || loadBest(true) > 0;
  if (!hardUnlocked) hard = false;

  const state = {
    phase: 'title', // title | playing | over
    startedAt: 0,
    score: 0,
    lives: START_LIVES,
    streak: 0,
    level: 0,
    round: null,
    acceptRestartAt: 0,
    pausedAt: 0,
    pendingRound: false,
    timers: [],
    history: [], // one { level, result: 'hit' | 'miss' | 'slow' } per round
    bestStreak: 0,
    nemesis: null,
    sinceShuffle: 0, // rounds played since the pad last shuffled
    lastKey: null, // key pressed in the previous round, for "last key" prompts
    skill: 0, // nudges prompt difficulty: up with each correct answer, down after a miss
    ease: 0, // rounds left of lighter prompts after a miss
    introQueue: [], // level ids whose intro cards are waiting to be read
    runHard: false, // the setting this run started with; toggling mid-run applies on restart // the most complex prompt the player got wrong
  };
  let nextExpr = createGenerator();

  const later = (fn, ms) => state.timers.push(setTimeout(fn, ms));
  const clearTimers = () => { state.timers.forEach(clearTimeout); state.timers = []; };
  const elapsed = () => (performance.now() - state.startedAt) / 1000;
  // Seconds on the difficulty clock, which hard mode runs faster and starts ahead.
  // Level number shown to the player: hard mode counts from 1 at its later starting level.
  const levelOffset = () => (state.runHard ? levelFor(HARD.start) : 0);
  const shownLevel = (level = state.level) => level + 1 - levelOffset();
  const gameSeconds = () => (state.runHard ? HARD.start + elapsed() * HARD.clock : elapsed() * NORMAL_CLOCK);

  function updateHud() {
    els.lives.innerHTML = Array.from({ length: START_LIVES }, (_, i) =>
      `<span class="heart ${i < state.lives ? '' : 'lost'}">♥</span>`).join('');
    els.score.textContent = state.score;
    renderStreak();
    els.level.textContent = `Level ${shownLevel()}`;
    // Shows the running game's setting in play, otherwise the one the next game will use.
    els.hardBadge.hidden = !(state.phase === 'playing' ? state.runHard : hard);
    els.hudBest.textContent = best;
  }

  // Streak styling steps up every 10 and tops out at 50; milestones keep coming every 50 after that.
  const STREAK_TIERS = [10, 20, 30, 40, 50];
  const MAX_TIER = STREAK_TIERS.length;
  const streakTier = (n) => STREAK_TIERS.filter((t) => n >= t).length;
  const isMilestone = (n) => STREAK_TIERS.includes(n) || (n > 50 && n % 50 === 0);
  function renderStreak() {
    const n = state.streak;
    const tier = streakTier(n);
    els.streak.textContent = n >= 3 ? `${tier >= 4 ? '🔥 ' : ''}${n} streak` : '';
    STREAK_TIERS.forEach((_, i) => els.streak.classList.toggle(`tier-${i + 1}`, i + 1 === tier));
  }
  function bumpStreak() {
    els.streak.classList.remove('bump');
    void els.streak.offsetWidth;
    els.streak.classList.add('bump');
  }
  function celebrateStreak(n) {
    const tier = Math.min(MAX_TIER, Math.max(1, streakTier(n)));
    window.Sound.milestone(tier);
    els.streak.classList.add('milestone');
    later(() => els.streak.classList.remove('milestone'), 900);
    els.combo.textContent = n >= 50 ? `${n} streak! Unstoppable` : n >= 40 ? `${n} streak! On fire` : `${n} streak!`;
    els.combo.className = `combo tier-${tier}`;
    void els.combo.offsetWidth;
    els.combo.classList.add('show');
  }

  // Normal mode leaves new-mechanic instructions up longer; hard-mode players already know them.
  function showBanner(text) {
    els.banner.textContent = text;
    els.banner.style.setProperty('--banner-time', state.runHard ? '2.4s' : '4.5s');
    els.banner.classList.remove('show');
    void els.banner.offsetWidth;
    els.banner.classList.add('show');
  }

  function showFeedback(text, kind) {
    els.feedback.textContent = text;
    els.feedback.className = `feedback ${kind}`;
  }

  function startGame() {
    clearTimers();
    resetLayout();
    renderLegend();
    nextExpr = createGenerator();
    Object.assign(state, { introQueue: [], phase: 'playing', startedAt: performance.now(), score: 0, lives: START_LIVES, streak: 0, level: hard ? levelFor(HARD.start) : 0, round: null, pausedAt: 0, pendingRound: false, history: [], skill: 0, sinceShuffle: 0, lastKey: null, ease: 0, heldExpr: null, bestStreak: 0, nemesis: null, runHard: hard });
    els.paused.hidden = true;
    els.pauseNote.textContent = '';
    document.body.classList.remove('is-paused');
    els.title.hidden = true;
    els.over.hidden = true;
    document.body.classList.add('playing');
    showFeedback('', '');
    updateHud();
    els.intro.hidden = true;
    els.prompt.textContent = 'Get ready…';
    if (!loadSeen().has('basic')) showIntros(['basic']);
    later(nextRound, 1100);
  }

  function nextRound() {
    if (state.phase !== 'playing') return;
    // A round scheduled during a pause starts once play resumes.
    if (state.pausedAt) { state.pendingRound = true; return; }
    // A prompt held back behind its intro cards plays as soon as they're read.
    if (state.heldExpr) { const held = state.heldExpr; state.heldExpr = null; startRound(held.expr, held.seconds, held.easing, held.freebie); return; }
    const seconds = gameSeconds();
    const level = levelFor(seconds);
    if (level > state.level) {
      state.level = level;
      window.Sound.levelUp();
      // Level-wide changes get their card now; prompt rules get theirs when a prompt first uses them.
      const id = LEVELS[level].id;
      const seen = loadSeen();
      if (LEVEL_CARDS.includes(id) && !seen.has(id)) { showIntros([id]); state.pendingRound = true; return; }
    }
    // Shuffle on reaching the level and every few rounds after, with a beat to re-read the pad.
    if (state.level >= SHUFFLE && (state.sinceShuffle === 0 || state.sinceShuffle >= SHUFFLE_EVERY)) {
      state.sinceShuffle = 1;
      shufflePad();
      later(nextRound, 1100);
      return;
    }
    if (state.sinceShuffle > 0) state.sinceShuffle += 1;
    // After a miss, two rounds with extra time let the player recover instead of spiralling.
    const easing = state.ease > 0;
    if (easing) state.ease -= 1;
    const expr = nextExpr(state.level, { lastKey: state.lastKey, seconds, skill: state.skill + (state.runHard ? HARD.boost : 0), stackedNots: loadSeen().has('not') });
    const unseen = rulesIn(expr).filter((id) => !loadSeen().has(id));
    // A rule's first prompt is its card's own simple example, and a miss on it is free.
    if (unseen.length) {
      const id = unseen[0];
      state.heldExpr = { expr: freebieFor(id) || expr, seconds, easing, freebie: true };
      state.pendingRound = true;
      showIntros([id]);
      return;
    }
    startRound(expr, seconds, easing);
  }

  function freebieFor(id) {
    if (id === 'memory') return state.lastKey ? Object.assign(lastKey(state.lastKey), { style: {} }) : null;
    const intro = INTROS[id];
    if (!intro || !intro.expr) return null;
    const expr = JSON.parse(JSON.stringify(intro.expr));
    expr.style = { symbols: !!intro.symbols, lyingColors: !!intro.lying };
    return expr;
  }

  function startRound(expr, seconds, easing, freebie = false) {
    const limit = timeLimit(state.level, seconds, expr) * (state.runHard ? HARD.time : 1) * (easing ? 1.25 : 1);
    const now = performance.now();
    state.round = { expr, answers: evaluate(expr), needAll: needsAll(expr), pressed: new Set(), limit, deadline: now + limit, active: true, freebie };
    Object.values(els.tiles).forEach((t) => t.classList.remove('valid', 'hit', 'miss'));
    showFeedback('', '');
    renderPrompt(expr);
    renderDebug(easing);
    updateHud();
  }

  function renderTitleHint() {
    els.titleHint.textContent = isTouch() ? 'Tap to start' : 'Press any arrow key to start';
  }

  function shufflePad() {
    shuffleLayout();
    renderLegend();
    state.round = null;
    els.prompt.textContent = 'Shuffle!';
    showFeedback('Check the keys', '');
    Object.values(els.tiles).forEach((t) => {
      t.classList.remove('valid', 'hit', 'miss', 'shuffled');
      void t.offsetWidth;
      t.classList.add('shuffled');
    });
    window.Sound.shuffle();
  }

  // keyId is null when the timer ran out without a press.
  function resolve(keyId) {
    const round = state.round;
    if (!round || !round.active) return;
    // "and" prompts stay open until every named key is pressed once; any other press fails.
    if (round.needAll && keyId && round.answers.has(keyId) && !round.pressed.has(keyId)) {
      round.pressed.add(keyId);
      els.tiles[keyId].classList.add('hit');
      if (round.pressed.size < round.answers.size) {
        showFeedback(`${round.pressed.size} of ${round.answers.size}`, 'good');
        return;
      }
    }
    round.active = false;
    // After an "and" prompt there's no single last key, so memory prompts wait a round.
    state.lastKey = round.needAll ? null : keyId;
    const pressedNothing = keyId === null;
    const correct = round.needAll ? round.pressed.size === round.answers.size
      : pressedNothing ? round.answers.size === 0 : round.answers.has(keyId);
    const tile = keyId && els.tiles[keyId];
    if (correct || !round.freebie) recordRound(round.expr, correct ? 'hit' : pressedNothing ? 'slow' : 'miss');

    if (correct) {
      state.streak += 1;
      state.skill = Math.min(1.2, state.skill + 0.1);
      // Points grow exponentially with the prompt's difficulty, plus a small streak bonus.
      state.score += Math.max(1, Math.round(1.5 ** difficulty(round.expr))) + Math.floor(state.streak / 5);
      if (tile) tile.classList.add('hit');
      if (isMilestone(state.streak)) celebrateStreak(state.streak);
      else if (pressedNothing) window.Sound.correctNothing();
      else window.Sound.correct(state.streak);
      showFeedback(pressedNothing ? 'Nice restraint' : 'Correct', 'good');
      document.body.classList.add('flash-good');
      later(() => document.body.classList.remove('flash-good'), 180);
    } else {
      if (!round.freebie) {
        state.lives -= 1;
        if (state.streak >= STREAK_TIERS[0]) { window.Sound.comboBreak(); showBanner(`Streak broken at ${state.streak}`); }
        state.streak = 0;
        state.ease = 2;
        state.skill = Math.max(-1.5, Math.min(0, state.skill) - 0.8);
      }
      if (tile) tile.classList.add('miss');
      round.answers.forEach((id) => { if (!round.pressed.has(id)) els.tiles[id].classList.add('valid'); });
      window.Sound.wrong();
      const memoryKey = toTokens(round.expr).find((t) => t.atom && t.atom.attr === 'last');
      const why = round.answers.size === 0 ? 'Answer: press nothing'
        : memoryKey ? `Last key was ${KEYS.find((k) => k.id === memoryKey.atom.key).glyph}`
        : pressedNothing ? (round.pressed.size ? `Too slow: ${round.pressed.size} of ${round.answers.size}` : 'Too slow')
        : round.needAll && round.pressed.has(keyId) ? 'Already pressed that one' : 'Wrong key';
      showFeedback(round.freebie ? `${why}. Free round, no life lost` : why, 'bad');
      document.body.classList.add('shake');
      later(() => document.body.classList.remove('shake'), 350);
    }
    updateHud();
    if (correct && state.streak >= 3) bumpStreak();
    els.timer.style.transform = 'scaleX(0)';

    if (state.lives <= 0) later(endGame, 900);
    else later(nextRound, correct ? 420 : 1100);
  }

  function recordRound(expr, result) {
    state.history.push({ level: state.level, result });
    const ops = opCount(expr);
    if (result === 'hit') {
      state.bestStreak = Math.max(state.bestStreak, state.streak + 1);
    } else if (!state.nemesis || ops >= state.nemesis.ops) {
      state.nemesis = { text: toText(expr), ops };
    }
  }

  // Wordle-style summary: one emoji row per level reached, plus the standout prompts.
  function shareText() {
    const marks = { hit: '🟩', miss: '🟥', slow: '⬛' };
    const rows = [];
    LEVELS.forEach((_, level) => {
      const rounds = state.history.filter((h) => h.level === level);
      if (!rounds.length) return;
      const squares = rounds.slice(0, 10).map((h) => marks[h.result]).join('');
      rows.push(`L${shownLevel(level)} ${squares}${rounds.length > 10 ? ` +${rounds.length - 10}` : ''}`);
    });
    const lines = [
      `Not not game 🧠 ${state.score} pts · Level ${shownLevel()}${state.runHard ? ' · 🌶️ Hard' : ''}`,
      `🔥 Best streak ${state.bestStreak}`,
      ...rows,
    ];
    if (state.nemesis) lines.push(`💀 Got me: ${state.nemesis.text}`);
    lines.push(location.href.split(/[?#]/)[0]);
    return lines.join('\n');
  }

  async function share() {
    const text = shareText();
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      els.shareStatus.textContent = 'Copied!';
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      els.shareStatus.textContent = 'Select the text above to copy it';
    }
  }

  function endGame() {
    state.phase = 'over';
    state.round = null;
    document.body.classList.remove('playing');
    window.Sound.gameOver();
    best = loadBest(state.runHard);
    if (state.score > best) {
      best = state.score;
      try { localStorage.setItem(bestKey(state.runHard), String(best)); } catch (_) { /* storage unavailable */ }
    }
    if (!state.runHard && !hardUnlocked) {
      hardUnlocked = true;
      try { localStorage.setItem(UNLOCK_KEY, '1'); } catch (_) { /* storage unavailable */ }
      renderHard();
    }
    els.finalScore.textContent = state.score;
    els.sharePreview.textContent = shareText();
    els.shareStatus.textContent = '';
    els.best.textContent = best;
    els.over.hidden = false;
    state.acceptRestartAt = performance.now() + 900;
  }

  function tick() {
    const now = performance.now();
    const round = state.round;
    if (state.phase === 'playing' && round && round.active && !state.pausedAt) {
      const remaining = Math.max(0, round.deadline - now);
      const frac = remaining / round.limit;
      els.timer.style.transform = `scaleX(${frac})`;
      els.timer.classList.toggle('low', frac < 0.3);
      if (remaining <= 0) resolve(null);
    }
    requestAnimationFrame(tick);
  }

  // Shared by keyboard and touch; keyId is one of KEYS[].id.
  function handleInput(keyId) {
    window.Sound.unlock();
    if (state.phase === 'title' || (state.phase === 'over' && performance.now() >= state.acceptRestartAt)) {
      window.Sound.press(keyId);
      startGame();
      return;
    }
    if (state.phase !== 'playing' || state.pausedAt) return;

    window.Sound.press(keyId);
    const tile = els.tiles[keyId];
    tile.classList.remove('pressed');
    void tile.offsetWidth;
    tile.classList.add('pressed');
    resolve(keyId);
  }

  // Freezes the game clock and the current round's deadline until resume().
  function pause() {
    if (state.phase !== 'playing' || state.pausedAt) return;
    state.pausedAt = performance.now();
    els.paused.hidden = false;
    document.body.classList.add('is-paused');
  }

  function resume() {
    if (!state.pausedAt) return;
    const pausedFor = performance.now() - state.pausedAt;
    state.startedAt += pausedFor;
    if (state.round) state.round.deadline += pausedFor;
    state.pausedAt = 0;
    els.paused.hidden = true;
    document.body.classList.remove('is-paused');
    if (state.pendingRound) { state.pendingRound = false; nextRound(); }
  }

  const togglePause = () => (state.introQueue.length ? advanceIntro() : state.pausedAt ? resume() : pause());

  const loadSeen = () => {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (_) { return new Set(); }
  };
  function markSeen(id) {
    const seen = loadSeen();
    seen.add(id);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch (_) { /* storage unavailable */ }
  }
  // Intro ids for the rules a prompt actually shows, in teaching order.
  const RULE_ORDER = ['not', 'stacked', 'nothing', 'anything', 'symbols', 'or', 'and', 'lyingColors', 'memory', 'missing'];
  function rulesIn(expr) {
    const found = mechanicsOf(expr);
    const atoms = toTokens(expr).filter((t) => t.atom).map((t) => t.atom.attr);
    found.delete('nothing');
    if (hasStackedNot(expr)) found.add('stacked');
    if (atoms.includes('none')) found.add('nothing');
    if (atoms.includes('any')) found.add('anything');
    const style = expr.style || {};
    // Symbols only render on direction or shape words.
    if (style.symbols && atoms.some((a) => a === 'dir' || a === 'shape')) found.add('symbols');
    // A lie is only guaranteed on a color word; on other words it's left to chance.
    if (style.lyingColors && atoms.includes('color')) found.add('lyingColors');
    return RULE_ORDER.filter((id) => found.has(id));
  }

  // Intro cards hold the game clock like a pause; the last one resumes play.
  function showIntros(ids) {
    state.introQueue = ids;
    if (!state.pausedAt) state.pausedAt = performance.now();
    renderIntro();
  }
  function renderIntro() {
    const id = state.introQueue[0];
    const intro = INTROS[id];
    const fresh = loadSeen().size === 0 && id === 'basic';
    els.introTag.textContent = fresh ? 'How to play' : 'New rule';
    els.introTitle.textContent = intro.title;
    els.introBody.textContent = intro.body;
    els.introExample.innerHTML = intro.expr ? exampleHtml(intro) : `<div class="intro-icon">${intro.icon}</div>`;
    els.intro.hidden = false;
  }
  function advanceIntro() {
    if (!state.introQueue.length) return;
    markSeen(state.introQueue.shift());
    if (state.introQueue.length) { renderIntro(); return; }
    els.intro.hidden = true;
    resume();
  }
  // The example prompt, then the keys that answer it (or ∅ for "nothing").
  function exampleHtml(intro) {
    const text = toTokens(intro.expr).map((t) => {
      if (t.kind !== 'atom') return `<span class="${t.kind}">${t.text}</span>`;
      if (intro.symbols && t.atom.attr === 'shape') return shapeSvg(t.atom.value, '#e8e8ef', 30);
      const color = intro.lying ? HEX.red : t.atom.attr === 'color' ? HEX[t.atom.value] : '#f4f4f8';
      return `<span style="color:${color}">${t.text}</span>`;
    }).join(' ');
    const answers = [...evaluate(intro.expr)];
    const keys = answers.length
      ? answers.map((id) => { const k = KEYS.find((key) => key.id === id); return shapeSvg(k.shape, HEX[k.color], 22); })
        .join(`<span class="or">${needsAll(intro.expr) ? '+' : '/'}</span>`)
      : '<span class="intro-none">∅ press nothing</span>';
    return `<div class="intro-prompt">${text}</div><div class="intro-arrow">→</div><div class="intro-keys">${keys}</div>`;
  }

  document.addEventListener('keydown', (e) => {
    // While an intro card is up, any plain key moves on.
    if (state.introQueue.length && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (!e.repeat) advanceIntro(); return; }
    if (e.code === 'Escape') { e.preventDefault(); togglePause(); return; }
    if (e.code === 'KeyH') { toggleHard(); return; }
    if (e.code === 'KeyD' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); toggleDebug(); return; }
    // Leave other browser shortcuts (Cmd+R, Cmd+H, ...) to the browser.
    if (e.metaKey || e.ctrlKey) return;
    if (e.code === 'KeyR' && !e.repeat) { e.preventDefault(); window.Sound.unlock(); startGame(); return; }
    const key = byCode[e.code];
    if (!key) return;
    e.preventDefault();
    if (e.repeat) return;
    handleInput(key.id);
  });

  // pointerdown fires immediately on touch, without the click delay.
  Object.entries(els.tiles).forEach(([id, tile]) => {
    tile.addEventListener('pointerdown', (e) => { e.preventDefault(); handleInput(id); });
  });
  // Touch screens start by tapping the card; with a keyboard, only an arrow key starts.
  const isTouch = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  [els.title, els.over].forEach((overlay) => {
    overlay.addEventListener('pointerdown', (e) => { if (!isTouch()) return; e.preventDefault(); handleInput('up'); });
  });
  // Keep share interactions from also counting as a tap-to-restart on the overlay.
  [els.share, els.sharePreview].forEach((el) => el.addEventListener('pointerdown', (e) => e.stopPropagation()));
  els.share.addEventListener('click', () => { share(); els.share.blur(); });
  els.restart.addEventListener('pointerdown', (e) => e.stopPropagation());
  els.restart.addEventListener('click', () => { els.restart.blur(); startGame(); });
  els.intro.addEventListener('pointerdown', (e) => { e.preventDefault(); advanceIntro(); });
  els.paused.addEventListener('pointerdown', (e) => { e.preventDefault(); resume(); });
  els.pauseBtn.addEventListener('click', () => { togglePause(); els.pauseBtn.blur(); });

  // A hidden tab pauses so it doesn't cost lives; the player resumes explicitly.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  function renderHard() {
    els.hardToggles.forEach((t) => {
      t.setAttribute('aria-checked', String(hard));
      t.classList.toggle('on', hard);
      // Hidden until a regular game has been finished.
      t.hidden = !hardUnlocked;
      t.querySelector('.toggle-note').textContent = '(for a challenge)';
    });
  }

  // Toggled from the pause menu; a change applies on restart, so a run's score reflects one setting.
  function toggleHard() {
    if (!hardUnlocked) return;
    if (state.phase === 'playing' && !state.pausedAt) return;
    hard = !hard;
    try { localStorage.setItem(HARD_KEY, hard ? '1' : '0'); } catch (_) { /* storage unavailable */ }
    best = loadBest();
    els.best.textContent = best;
    renderHard();
    updateHud();
    els.pauseNote.textContent = state.phase === 'playing' && hard !== state.runHard ? 'Applies when you restart' : '';
  }

  els.hardToggles.forEach((t) => {
    // Stop the overlay's tap-to-start from firing when the toggle is tapped.
    t.addEventListener('pointerdown', (e) => e.stopPropagation());
    t.addEventListener('click', () => { toggleHard(); t.blur(); });
  });

  const SPEAKER = '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>';
  const SOUND_ICONS = {
    on: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${SPEAKER}<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    off: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${SPEAKER}<path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  };
  function renderMute(muted) {
    els.mute.innerHTML = muted ? SOUND_ICONS.off : SOUND_ICONS.on;
    els.mute.setAttribute('aria-pressed', String(muted));
    els.mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  }
  renderMute(false);
  els.mute.addEventListener('click', () => {
    renderMute(window.Sound.toggleMute());
    els.mute.blur();
  });

  const helpToggle = $('#help-toggle');
  helpToggle.addEventListener('pointerdown', (e) => e.stopPropagation());
  helpToggle.addEventListener('click', () => {
    const on = helpToggle.getAttribute('aria-checked') !== 'true';
    helpToggle.setAttribute('aria-checked', String(on));
    helpToggle.classList.toggle('on', on);
    $('#pause-help').hidden = !on;
    helpToggle.blur();
  });

  // Debug panel: the current prompt's difficulty breakdown against the level's cap.
  // Toggled with Cmd+D (Ctrl+D elsewhere); the choice is remembered.
  const DEBUG_KEY = 'not-not-debug';
  const debugEl = document.createElement('aside');
  debugEl.className = 'debug';
  document.body.appendChild(debugEl);
  let debugOn = false;
  try { debugOn = localStorage.getItem(DEBUG_KEY) === '1'; } catch (_) { /* storage unavailable */ }
  const recentScores = [];
  if (debugOn) window.__notNotState = state;

  function renderDebug(easing) {
    const round = state.round;
    if (round && round.expr !== debugEl.lastExpr) {
      debugEl.lastExpr = round.expr;
      recentScores.unshift(difficulty(round.expr));
      recentScores.length = Math.min(recentScores.length, 12);
    }
    debugEl.hidden = !debugOn;
    if (!debugOn) return;
    const level = LEVELS[state.level];
    const seconds = gameSeconds().toFixed(1);
    if (!round) {
      debugEl.innerHTML = `<h2>Debug</h2><p>Level ${shownLevel()} (${level.id})</p><p>No prompt yet</p>`;
      return;
    }
    const parts = difficultyParts(round.expr);
    const score = difficulty(round.expr);
    const pct = Math.min(100, (score / 8) * 100);
    const keys = [...round.answers].map((id) => KEYS.find((k) => k.id === id).glyph).join(' ') || 'nothing';
    debugEl.innerHTML = `
      <h2>Debug <span>⌘D to hide</span></h2>
      <dl>
        <dt>Level</dt><dd>${shownLevel()} (${level.id})</dd>
        <dt>Clock</dt><dd>${seconds}s${state.runHard ? ' (hard)' : ''}</dd>
        <dt>Score</dt><dd><b>${score.toFixed(2)}</b>${round.expr.aim == null ? ' · new mechanic' : ` · aimed ${round.expr.aim.toFixed(2)}`}</dd>
        <dt>Target</dt><dd>${round.expr.target.toFixed(2)} (curve ${targetDifficulty(Number(seconds)).toFixed(2)}, skill ${state.skill >= 0 ? '+' : ''}${state.skill.toFixed(1)})</dd>
        <dt>Easing</dt><dd>${easing ? 'yes, +25% time' : 'no'}</dd>
      </dl>
      <div class="debug-bar"><span style="width:${pct}%"></span></div>
      <table>${parts.map(([name, w]) => `<tr><td>${name}</td><td>${w > 0 ? '+' : ''}${w}</td></tr>`).join('')}</table>
      <dl>
        <dt>Answer</dt><dd>${round.needAll ? 'all of ' : ''}${keys}</dd>
        <dt>Time</dt><dd>${(round.limit / 1000).toFixed(2)}s</dd>
        <dt>Recent</dt><dd>${recentScores.map((n) => n.toFixed(1)).join(' ')}</dd>
      </dl>`;
  }

  function toggleDebug() {
    debugOn = !debugOn;
    try { localStorage.setItem(DEBUG_KEY, debugOn ? '1' : '0'); } catch (_) { /* storage unavailable */ }
    if (debugOn) window.__notNotState = state;
    renderDebug(false);
  }

  renderLegend();
  renderTitleCard();
  renderTitleHint();
  renderHard();
  renderDebug(false);
  // The ?v= value (month.day.year.build) on this script's URL doubles as the visible version, to spot stale caches.
  const ownSrc = [...document.scripts].map((el) => el.src).find((src) => src.includes('game.js')) || '';
  $('#version').textContent = (ownSrc.match(/[?&]v=([^&]+)/) || [, '?'])[1];
  updateHud();
  els.best.textContent = best;
  requestAnimationFrame(tick);
})();
