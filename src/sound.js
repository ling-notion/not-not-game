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
  const KEY_NOTES = { up: 329.63, right: 392.0, down: 261.63, left: 293.66 };

  const Sound = {
    unlock: ensure,
    press(keyId) {
      const f = KEY_NOTES[keyId] || 600;
      tone(f, { dur: 0.12, type: 'triangle', vol: 0.5 });
      tone(f * 2, { dur: 0.05, type: 'sine', vol: 0.08 });
    },
    correct(streak = 0) {
      // Climbs one pentatonic step every 3 answers in a streak, topping out an octave up.
      const steps = [0, 2, 4, 7, 9, 12];
      const lift = Math.pow(2, steps[Math.min(Math.floor(streak / 3), steps.length - 1)] / 12);
      tone(523.25 * lift, { start: 0.04, dur: 0.12, type: 'sine', vol: 0.35 });
      tone(783.99 * lift, { start: 0.1, dur: 0.18, type: 'sine', vol: 0.3 });
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
    // Streak milestones: a rising fanfare that grows with each tier (1 = 10 up to 5 = 50 and beyond).
    milestone(tier = 1) {
      const root = 523.25;
      const steps = [0, 4, 7, 12, 16, 19, 24, 28].slice(0, 3 + Math.min(tier, 5));
      steps.forEach((st, i) => {
        const f = root * Math.pow(2, st / 12);
        tone(f, { start: i * 0.06, dur: 0.2, type: 'triangle', vol: 0.4 });
        tone(f * 1.005, { start: i * 0.06, dur: 0.2, type: 'sawtooth', vol: 0.06 });
      });
      const end = steps.length * 0.06;
      // A held major chord, then sparkles on the higher tiers.
      [0, 4, 7, 12].forEach((st) => tone(root * Math.pow(2, st / 12), { start: end, dur: 0.5 + tier * 0.12, type: 'sine', vol: 0.22 }));
      if (tier >= 2) [2093, 2637, 3136].forEach((f, i) => tone(f, { start: end + 0.1 + i * 0.07, dur: 0.12, type: 'sine', vol: 0.12 }));
      if (tier >= 4) tone(130.81, { start: end, dur: 0.7, type: 'sawtooth', vol: 0.12, slide: 261.63 });
    },
    // Losing a long streak: a falling shatter.
    comboBreak() {
      [880, 660, 494, 330].forEach((f, i) => tone(f, { start: i * 0.05, dur: 0.14, type: 'square', vol: 0.12, slide: f * 0.7 }));
      tone(160, { start: 0.1, dur: 0.45, type: 'sawtooth', vol: 0.22, slide: 55 });
    },
    shuffle() {
      tone(300, { dur: 0.22, type: 'triangle', vol: 0.3, slide: 900 });
      tone(450, { start: 0.08, dur: 0.22, type: 'sine', vol: 0.2, slide: 1200 });
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
