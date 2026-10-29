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
| 27s | `or` |
| 40s | Words are drawn in misleading colors |
| 55s | Arrow and shape symbols replace some words |
| 72s | Nested expressions and misleading symbol colors |

Longer expressions get a little extra time. Correct answers score more at higher levels, and every fifth answer in a streak adds a bonus point. Your best score is saved in the browser.

## Development

```bash
npm test
```

- `src/expressions.js`: building, evaluating, rendering, and generating expressions (unit tested)
- `src/sound.js`: synthesized sound effects with the Web Audio API
- `src/game.js`: game loop, input, and rendering
