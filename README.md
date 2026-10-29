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
| 5s | `not` |
| 13s | `nothing`, `anything`, stacked negations |
| 24s | Arrow and shape symbols replace some words |
| 34s | `or` |
| 46s | `red and blue`: press every key named, in any order |
| 58s | `missing: red green blue`: press the key that isn't listed |
| 70s | Words are drawn in misleading colors |
| 82s | `last key`: the key you pressed in the previous round |
| 94s | Shuffle: every 12 rounds the colors and shapes move to different arrows |
| 106s | Fade: some prompts disappear after a short look |
| 120s | Chaos: the difficulty cap rises so mechanics combine more |
| 146s | Endless: same rules, the timer keeps shrinking |

Each level unlocks a mechanic and raises a difficulty cap. Every prompt is built from the unlocked mechanics and scored by adding up the weights of what it uses (`WEIGHTS` in `src/expressions.js`). Prompts over the cap are rejected. Most prompts land near the cap, but easy ones still slip in now and then, and half the prompts at a new level feature its new mechanic.

Longer expressions get a little extra time. Correct answers score more at higher levels, and every fifth answer in a streak adds a bonus point. Your best score is saved in the browser.

## Development

```bash
npm test
```

- `src/expressions.js`: building, evaluating, rendering, and generating expressions (unit tested)
- `src/sound.js`: synthesized sound effects with the Web Audio API
- `src/game.js`: game loop, input, and rendering

When you change anything in `src/`, bump the `?v=` number on the script and stylesheet tags in `index.html`. Otherwise browsers can mix a new page with old cached files.
