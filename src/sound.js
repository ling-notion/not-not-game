// Synthesized sound effects (Web Audio, no asset files). The context starts on the first key press.
(function (root) {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // One enveloped oscillator note; `slide` bends the pitch toward a target frequency.
  function tone(freq, { start = 0, dur = 0.15, type = 'sine', vol = 0.6, slide } = {}) {
    if (muted || !ensure()) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Each arrow gets its own note from a major pentatonic chord so presses sound musical together.
  const KEY_NOTES = { up: 659.25, right: 783.99, down: 523.25, left: 587.33 };

  const Sound = {
    unlock: ensure,
    press(keyId) {
      const f = KEY_NOTES[keyId] || 600;
      tone(f, { dur: 0.12, type: 'triangle', vol: 0.5 });
      tone(f * 2, { dur: 0.06, type: 'sine', vol: 0.15 });
    },
    correct(streak = 0) {
      // Pitch climbs with the streak, capped at one octave.
      const lift = Math.pow(2, Math.min(streak, 12) / 12);
      tone(880 * lift, { start: 0.05, dur: 0.12, type: 'sine', vol: 0.4 });
      tone(1318.5 * lift, { start: 0.11, dur: 0.2, type: 'sine', vol: 0.35 });
    },
    correctNothing() {
      tone(392, { dur: 0.25, type: 'sine', vol: 0.35, slide: 784 });
    },
    wrong() {
      tone(180, { dur: 0.28, type: 'sawtooth', vol: 0.3, slide: 90 });
      tone(120, { dur: 0.28, type: 'square', vol: 0.12, slide: 70 });
    },
    levelUp() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone(f, { start: i * 0.07, dur: 0.18, type: 'triangle', vol: 0.4 }));
    },
    gameOver() {
      [392, 349.23, 311.13, 261.63].forEach((f, i) =>
        tone(f, { start: i * 0.16, dur: 0.3, type: 'triangle', vol: 0.4 }));
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    get muted() {
      return muted;
    },
  };

  root.Sound = Sound;
})(this);
