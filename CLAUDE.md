# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Project

No build step required. Open `boids.html` directly in any modern browser. All dependencies are either bundled locally (`plotly-2.16.1.min.js`) or loaded from CDN (Bootstrap 5, jQuery 3.4.1).

## Architecture

This is a pure-JavaScript boids flocking simulation with a genetic algorithm optimizer. No framework, no module bundler — all files are loaded via `<script>` tags in `boids.html`.

### Key files

| File | Role |
|---|---|
| `boids.js` | Core simulation: `Canvas`, `Scene`, and `Particle` classes |
| `ga_optimizer.js` | `BoidsGAOptimizer` class — evolves the 6 weight parameters |
| `gui.js` | Slider bindings and UI event handlers |
| `boids.html` | Entry point — loads scripts, defines DOM layout |

### Simulation (`boids.js`)

Three classes cooperate each animation frame:

- **`Canvas`** — renders to HTML5 canvas (boids, obstacles, target, vectors)
- **`Scene`** — owns the config object, manages all `Particle` instances, places obstacles and target, steps physics, computes fitness metrics
- **`Particle`** — individual boid; computes six steering vectors (cohesion, alignment, separation, target, obstacle avoidance, random noise) and blends them via weighted sum in `updateVector()`

Physics constants at the top of `boids.js` (lines 1–4): `MIN_SPEED`, `MAX_SPEED`, `MAX_ACCELERATION`, `MAX_OBSTACLE_ACCELERATION`.

The scene config object (lines 7–35) holds all ~25 tunable parameters and their defaults.

### Fitness function (`Scene.computeFitness`)

Seven metrics are tracked per frame:

| Metric | Weight |
|---|---|
| `timeScore` — fraction reaching target quickly | 40% |
| `orderParameter` — velocity alignment | 30% |
| `targetSuccess` — % boids in target zone | 20% |
| `collisionRate` — obstacle collisions per step | −10% |
| `crowdingPenalty` — excessive clustering | −20% |

### Genetic Algorithm (`ga_optimizer.js`)

`BoidsGAOptimizer` optimizes the 6 behavioral weights (`alignment`, `cohesion`, `separation`, `targetWeight`, `avoidance`, `randomWeight`):

- Population: 30, Generations: 40
- Tournament selection (size 3), blend-alpha crossover (90%), Gaussian mutation (18%, σ=0.08), elitism (top 2)
- Each genome is evaluated on 3 seeds (12345, 23456, 34567) and fitness is averaged for robustness
- `runAsync()` is the non-blocking entry point; `runAndApplyBoidsGAOptimizationAsync()` runs the GA and applies results to the live simulation

### GUI (`gui.js`)

Slider IDs map to config keys: `wa`→`alignment`, `wc`→`cohesion`, `ws`→`separation`, `wt`→`targetWeight`, `wo`→`avoidance`, `wr`→`randomWeight`, `rSep`→`separationRadius`, `rInt`→`interactionRadius`, `rObs`→`obstaclePerceptionRadius`.

`setSliders()` initializes DOM from config; `sliderInput()` updates config from DOM in real time.
