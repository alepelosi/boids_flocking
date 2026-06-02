# Boids Target Optimizer

This project simulates a flock of boids that must follow a leader toward changing targets while avoiding obstacles and preserving flock structure. It compares optimized parameters found by a Genetic Algorithm (GA) and CMA-ES.

The simulation uses a leader-based target model: only the leader can directly see the target, while the other boids must follow the leader and maintain flocking behavior. The repeated-test workflow evaluates a chosen configuration across many seeded environments and reports target-reaching, formation quality, spacing, collisions, and fitness.

## Files

- `boids.html`: browser interface for the simulation and experiments.
- `boids.js`: boid dynamics, target logic, metrics, and fitness.
- `gui.js`: UI controls, repeated tests, exports, and screenshots.
- `ga_optimizer.js`: Genetic Algorithm optimizer.
- `cma_optimizer.js`: CMA-ES optimizer.
- `style.css`: page styling.
- `plot_optimizer_runs.py`: plots run-by-run metrics from exported CSV files.
- `requirements.txt`: optional Python plotting dependencies.

## Run The Simulator

Start a local server from the project folder:

```bash
python3 -m http.server 8765
```

Open:

```text
http://127.0.0.1:8765/boids.html
```

The page lets you:

- tune boid parameters manually;
- run GA or CMA-ES;
- apply optimized weights to the simulation;
- run repeated tests across many seeds;
- export results as CSV or JSON;
- export selected optimizer weights as CSV or JSON;
- download a screenshot of the simulation scene.

## Recommended Experiment Workflow

1. Choose optimizer settings for GA or CMA-ES.
2. Run the optimizer.
3. Apply the best weights found by the optimizer.
4. Run a repeated test, for example 100 runs with 5000 steps per run.
5. Export the repeated-test results as CSV.
6. Repeat the same process for the other optimizer.
7. Use `plot_optimizer_runs.py` to compare the run-by-run metrics.

For fair comparisons, use the same repeated-test seed and number of runs for GA and CMA-ES.

## Plot Results

The plotting script reads the exported repeated-test CSV files. It supports comma-separated and semicolon-separated CSV exports.

SVG output works without extra packages:

```bash
python3 plot_optimizer_runs.py ga.csv cma-es.csv \
  --output boids_ga_cma_metrics.svg \
  --summary-csv boids_ga_cma_summary.csv \
  --no-show
```

To plot only selected metrics:

```bash
python3 plot_optimizer_runs.py ga.csv cma-es.csv \
  --metrics fitness,targets,targetTime,order,nn,collisionRate \
  --output boids_key_metrics.svg \
  --summary-csv boids_key_summary.csv \
  --no-show
```

To also export every metric panel as a separate PNG in a folder:

```bash
python3 plot_optimizer_runs.py ga.csv cma-es.csv \
  --output boids_ga_cma_metrics.svg \
  --summary-csv boids_ga_cma_summary.csv \
  --individual-png-dir plots \
  --no-show
```

The default metrics are:

```text
fitness, targets, targetTime, order, nn, spacingScore, cluster, collisionRate, targetScore, formationScore, constraintScore
```

## Optional Python Setup For PNG Plots

The script can generate SVG files without installing anything. For PNG output or interactive matplotlib windows, install the plotting dependency:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Then run:

```bash
python3 plot_optimizer_runs.py ga.csv cma-es.csv \
  --output boids_ga_cma_metrics.png
```

## Metrics

- `fitness`: final objective score used for comparison.
- `targets`: number of targets reached during a run.
- `targetTime`: average number of simulation steps between target changes.
- `order`: alignment/order of the flock.
- `nn`: average nearest-neighbor distance.
- `spacingScore`: score for avoiding collapse into a tight blob.
- `cluster`: largest connected flock fraction.
- `collisionRate`: fraction of boid-obstacle collisions.
- `targetScore`: target-reaching part of the fitness.
- `formationScore`: flock coherence/order part of the fitness.
- `constraintScore`: combined formation and spacing constraint score.
