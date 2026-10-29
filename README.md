# Not not game

A small browser game about reading logic under time pressure. Plain HTML, CSS, and JavaScript, no build step.

## Play

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Each arrow key has a direction, a color, and a shape:

| Key | Color | Shape |
| --- | --- | --- |
| ↑ | red | circle |
| → | green | square |
| ↓ | blue | triangle |
| ← | yellow | star |

An expression appears. Press a key that satisfies it before the timer runs out. A wrong key or a timeout costs a life, and you have three.

| Expression | Meaning |
| --- | --- |
| `green` | Press the green key |
| `not red` | Press any key that isn't red |
| `not not up` | Press up |
| `nothing` | Don't press anything; let the timer run out |
| `anything` | Press any key |
| `red or left` | Press a key that is red or left |
| `blue and triangle` | Press a key that is both |

## Difficulty

The game gets harder as you survive, and the time limit shrinks within each level:

| Time | New rule |
| --- | --- |
| 0s | Single words |
| 6s | `not` |
| 15s | `nothing`, `anything`, stacked negations |
| 26s | Arrow and shape symbols replace some words |
| 38s | `or` |
| 50s | `red and blue`: press every key named, in any order |
| 64s | Words are drawn in misleading colors |
| 78s | `last key`: the key you pressed in the previous round |
| 92s | Shuffle: every 12 rounds the colors and shapes move to different arrows |
| 108s | Chaos: mechanics combine more as the curve keeps rising |
| 128s | `missing: red green blue`: press the key that isn't listed (the heaviest mechanic) |
| 154s | Endless: same rules, the timer keeps shrinking |

Levels only decide which mechanics exist. How hard prompts are follows a smooth curve over time (`targetDifficulty` in `src/expressions.js`). Every prompt is built from the unlocked mechanics and scored by adding up the weights of what it uses (`WEIGHTS`). Each prompt then aims at its own point near the curve:
- most land just under the curve
- about 15% are breathers a little below it
- nothing goes more than 0.7 above the curve, or more than about one step above the previous prompt
- heavy mechanics (like `missing`) wait until the curve is close to their cost, so they never spike in early

A mechanic unlocked in the last 14 seconds is featured in simple prompts on its own. A skill rating also nudges the curve: it rises slowly with correct answers and drops after a miss, so struggling players get breathing room and strong players get pushed. The answer timer also shrinks smoothly, and harder prompts get extra reading time. The first time a player reaches each mechanic, the game pauses on a card explaining it (remembered in localStorage), so normal mode runs its difficulty clock 1.3× fast. Hard mode starts 50 seconds in (or earlier, if the player hasn't been taught a rule before that point yet), and counts that as level 1. It runs the difficulty clock 1.3× faster, aims prompts slightly higher on the curve, and makes every timer 10% shorter. Secret nightmare mode (Shift+N, or tapping the dog three times) starts with every rule unlocked, aims prompts at difficulty 8 rising to 10 over two minutes with spikes up to about 1.7 above that, skips the rule cards, and plays a synthesized boss-music loop (only in nightmare). Once found, a 👹 switch in the bottom-right corner turns it on and off. Press Cmd+D (Ctrl+D on Windows/Linux) to see each prompt's score breakdown.

Longer expressions get a little extra time. Each correct answer scores 1.5^difficulty points (1 for a single word, about 11 at difficulty 6, about 38 at difficulty 9), times a streak multiplier: ×1.5 at a 10 streak, ×2 at 20, ×2.5 at 30, ×3 at 40 and ×3.5 from 50 on. A miss resets it. Your best score is saved in the browser.

## Development

```bash
npm test
```

- `src/expressions.js`: building, evaluating, rendering, and generating expressions (unit tested)
- `src/sound.js`: synthesized sound effects with the Web Audio API
- `src/game.js`: game loop, input, and rendering

When you change anything in `src/`, bump the `?v=` value on the script and stylesheet tags in `index.html`. It's `month.day.year.build`, like `10.28.26.1`; raise the last number for each change that day and reset it to 1 on a new day. Otherwise browsers can mix a new page with old cached files.
