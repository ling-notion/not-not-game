// Game loop, input handling, and rendering. Depends on window.NotNot and window.Sound.
(function () {
  'use strict';
  const { KEYS, COLORS, LEVELS, featureLevel, resetLayout, shuffleLayout, needsAll, difficulty, difficultyParts, targetDifficulty, evaluate, toTokens, toText, opCount, levelFor, timeLimit, createGenerator } = window.NotNot;

  const HEX = { red: '#ff5a5f', green: '#3ddc84', blue: '#4da3ff', yellow: '#ffd23f' };
  const START_LIVES = 3;
  const BEST_KEY = 'not-not-best';
  const HARD_KEY = 'not-not-hard';
  // Hard mode runs the difficulty clock faster, trims every answer window, and aims prompts
  // a little above the normal curve.
  // It also starts a minute into the game, skipping the warm-up levels.
  const HARD = { clock: 1.6, time: 0.85, boost: 0.8, start: 60 };
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
    hardToggles: [...document.querySelectorAll('.hard-toggle')],
    restart: $('#restart'),
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

  // Title card: a mini pad of the four keys, and each example's answer drawn as shapes.
  function renderTitleCard() {
    const mini = (k, size) => `<span class="mini" style="--c:${HEX[k.color]}">${shapeSvg(k.shape, HEX[k.color], size)}</span>`;
    document.querySelector('.legend').innerHTML = KEYS.map((k) => `
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

  function renderToken(t, style, asSymbol) {
    if (t.kind !== 'atom') return `<span class="${t.kind}">${t.text}</span>`;
    const { attr, value } = t.atom;
    if (asSymbol && attr === 'dir') {
      const key = KEYS.find((k) => k.dir === value);
      return `<span class="atom symbol">${key.glyph}</span>`;
    }
    if (asSymbol && attr === 'shape') {
      const fill = style.lyingColors ? HEX[pickOther(KEYS.find((k) => k.shape === value).color)] : '#e8e8ef';
      return `<span class="atom symbol">${shapeSvg(value, fill, 44)}</span>`;
    }
    let color = '#f4f4f8';
    if (style.lyingColors && attr === 'color') color = HEX[pickOther(value)];
    else if (style.lyingColors && Math.random() < 0.4) color = HEX[pickOther()];
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
    hardestSolved: null,
    nemesis: null,
    sinceShuffle: 0, // rounds played since the pad last shuffled
    lastKey: null, // key pressed in the previous round, for "last key" prompts
    skill: 0, // nudges prompt difficulty: up with each correct answer, down after a miss
    ease: 0, // rounds left of lighter prompts after a miss
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
  const gameSeconds = () => (state.runHard ? HARD.start + elapsed() * HARD.clock : elapsed());

  function updateHud() {
    els.lives.innerHTML = Array.from({ length: START_LIVES }, (_, i) =>
      `<span class="heart ${i < state.lives ? '' : 'lost'}">♥</span>`).join('');
    els.score.textContent = state.score;
    els.streak.textContent = state.streak >= 3 ? `${state.streak} streak` : '';
    els.level.textContent = `Level ${shownLevel()}`;
    // Shows the running game's setting in play, otherwise the one the next game will use.
    els.hardBadge.hidden = !(state.phase === 'playing' ? state.runHard : hard);
    els.hudBest.textContent = best;
  }

  function showBanner(text) {
    els.banner.textContent = text;
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
    Object.assign(state, { phase: 'playing', startedAt: performance.now(), score: 0, lives: START_LIVES, streak: 0, level: hard ? levelFor(HARD.start) : 0, round: null, pausedAt: 0, pendingRound: false, history: [], skill: 0, sinceShuffle: 0, lastKey: null, ease: 0, bestStreak: 0, hardestSolved: null, nemesis: null, runHard: hard });
    els.paused.hidden = true;
    els.pauseNote.textContent = '';
    document.body.classList.remove('is-paused');
    els.title.hidden = true;
    els.over.hidden = true;
    document.body.classList.add('playing');
    showFeedback('', '');
    updateHud();
    showBanner(hard ? 'Hard mode: all the basics are already in' : LEVELS[0].intro);
    els.prompt.textContent = 'Get ready…';
    later(nextRound, 1100);
  }

  function nextRound() {
    if (state.phase !== 'playing') return;
    // A round scheduled during a pause starts once play resumes.
    if (state.pausedAt) { state.pendingRound = true; return; }
    const seconds = gameSeconds();
    const level = levelFor(seconds);
    if (level > state.level) {
      state.level = level;
      showBanner(LEVELS[level].intro);
      window.Sound.levelUp();
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
    const expr = nextExpr(state.level, { lastKey: state.lastKey, seconds, skill: state.skill + (state.runHard ? HARD.boost : 0) });
    const limit = timeLimit(state.level, seconds, expr) * (state.runHard ? HARD.time : 1) * (easing ? 1.25 : 1);
    const now = performance.now();
    state.round = { expr, answers: evaluate(expr), needAll: needsAll(expr), pressed: new Set(), limit, deadline: now + limit, active: true };
    Object.values(els.tiles).forEach((t) => t.classList.remove('valid', 'hit', 'miss'));
    showFeedback('', '');
    renderPrompt(expr);
    renderDebug(easing);
    updateHud();
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
    recordRound(round.expr, correct ? 'hit' : pressedNothing ? 'slow' : 'miss');

    if (correct) {
      state.streak += 1;
      state.skill = Math.min(1.2, state.skill + 0.1);
      // Points grow exponentially with the prompt's difficulty, plus a small streak bonus.
      state.score += Math.max(1, Math.round(1.5 ** difficulty(round.expr))) + Math.floor(state.streak / 5);
      if (tile) tile.classList.add('hit');
      if (pressedNothing) window.Sound.correctNothing();
      else window.Sound.correct(state.streak);
      showFeedback(pressedNothing ? 'Nice restraint' : 'Correct', 'good');
      document.body.classList.add('flash-good');
      later(() => document.body.classList.remove('flash-good'), 180);
    } else {
      state.lives -= 1;
      state.streak = 0;
      state.ease = 2;
      state.skill = Math.max(-1.5, Math.min(0, state.skill) - 0.8);
      if (tile) tile.classList.add('miss');
      round.answers.forEach((id) => { if (!round.pressed.has(id)) els.tiles[id].classList.add('valid'); });
      window.Sound.wrong();
      const memoryKey = toTokens(round.expr).find((t) => t.atom && t.atom.attr === 'last');
      const why = round.answers.size === 0 ? 'Answer: press nothing'
        : memoryKey ? `Last key was ${KEYS.find((k) => k.id === memoryKey.atom.key).glyph}`
        : pressedNothing ? (round.pressed.size ? `Too slow: ${round.pressed.size} of ${round.answers.size}` : 'Too slow')
        : round.needAll && round.pressed.has(keyId) ? 'Already pressed that one' : 'Wrong key';
      showFeedback(why, 'bad');
      document.body.classList.add('shake');
      later(() => document.body.classList.remove('shake'), 350);
    }
    updateHud();
    els.timer.style.transform = 'scaleX(0)';

    if (state.lives <= 0) later(endGame, 900);
    else later(nextRound, correct ? 420 : 1100);
  }

  function recordRound(expr, result) {
    state.history.push({ level: state.level, result });
    const ops = opCount(expr);
    if (result === 'hit') {
      state.bestStreak = Math.max(state.bestStreak, state.streak + 1);
      if (!state.hardestSolved || ops > state.hardestSolved.ops) state.hardestSolved = { text: toText(expr), ops };
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
    if (state.hardestSolved) lines.push(`💪 Solved: ${state.hardestSolved.text}`);
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

  const togglePause = () => (state.pausedAt ? resume() : pause());

  document.addEventListener('keydown', (e) => {
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
  [els.title, els.over].forEach((overlay) => {
    overlay.addEventListener('pointerdown', (e) => { e.preventDefault(); handleInput('up'); });
  });
  // Keep share interactions from also counting as a tap-to-restart on the overlay.
  [els.share, els.sharePreview].forEach((el) => el.addEventListener('pointerdown', (e) => e.stopPropagation()));
  els.share.addEventListener('click', () => { share(); els.share.blur(); });
  els.restart.addEventListener('pointerdown', (e) => e.stopPropagation());
  els.restart.addEventListener('click', () => { els.restart.blur(); startGame(); });
  els.paused.addEventListener('pointerdown', (e) => { e.preventDefault(); resume(); });
  els.pauseBtn.addEventListener('click', () => { togglePause(); els.pauseBtn.blur(); });

  // A hidden tab pauses so it doesn't cost lives; the player resumes explicitly.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  function renderHard() {
    els.hardToggles.forEach((t) => {
      t.setAttribute('aria-checked', String(hard));
      t.classList.toggle('on', hard);
    });
  }

  // Lives on the title and game-over cards, so a run's score always reflects one setting.
  function toggleHard() {
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

  els.mute.addEventListener('click', () => {
    const muted = window.Sound.toggleMute();
    els.mute.textContent = muted ? 'Sound: off' : 'Sound: on';
    els.mute.setAttribute('aria-pressed', String(muted));
    els.mute.blur();
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
  renderHard();
  renderDebug(false);
  // The ?v= number on this script's URL doubles as the visible version, to spot stale caches.
  const ownSrc = [...document.scripts].map((el) => el.src).find((src) => src.includes('game.js')) || '';
  $('#version').textContent = (ownSrc.match(/[?&]v=(\d+)/) || [, '?'])[1];
  updateHud();
  els.best.textContent = best;
  requestAnimationFrame(tick);
})();
