# Boids Target Optimizer

This project simulates a flock of boids that must follow a leader toward changing targets while avoiding obstacles and preserving flock structure. It compares optimized parameters found by a Genetic Algorithm (GA) and CMA-ES.

The simulation uses a leader-based target model: only the leader can directly see the target, while the other boids must follow the leader and maintain flocking behavior. The repeated-test workflow evaluates a chosen configuration across many seeded environments and reports target-reaching, formation quality, spacing, collisions, and fitness.

## Files

- `boids.html`: browser interface for the simulation and experiments.
- `boids.js`: boid dynamics, target logic, metrics, and fitness.
- `gui.js`: UI controls, repeated tests, exports, and screenshots.
- `ga_optimizer.js`: Genetic Algorithm optimizer.
- `cma_optimizer.js`: CMA-ES optimizer.
- `run_headless_experiments.js`: command-line experiment runner for optimizer runs, repeated tests, weights, and evaluation history.
- `style.css`: page styling.
- `plot_optimizer_runs.py`: plots run-by-run metrics from exported CSV files.
- `plot_strategy_space.py`: plots PCA/strategy-space figures from optimizer history exports.
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
- reset the simulation weights to the pre-optimizer values;
- run repeated tests across many seeds;
- export results as CSV or JSON;
- export optimizer result tables as CSV or JSON;
- export selected optimizer weights as CSV or JSON;
- export full optimizer evaluation history for PCA or strategy-space analysis;
- download a screenshot of the simulation scene.

## Run Experiments Headlessly

For faster result collection, the optimizers can be run without the browser:

```bash
node run_headless_experiments.js --out results/final-experiments
```

The default headless setup runs:

```text
GA seeds: 24681357, 13579246, 31415926
CMA-ES seeds: 99991357, 27182818, 16180339
Population: 10
GA generations: 20
CMA-ES generations: 21
GA mutation: 0.20
GA selection: 0.50
CMA-ES sigma: 0.25
Training seeds: 3
Optimization steps: 1000
Repeated-test runs: 100
Repeated-test steps: 5000
Target changes during optimization: 0
```

This keeps the evaluation budget matched:

```text
GA: 10 * (20 + 1) = 210 evaluations
CMA-ES: 10 * 21 = 210 evaluations
```

The script writes:

```text
optimizer_weights.csv
optimizer_history.csv
repeated_results.csv
summary.json
```

Each optimizer run uses separate training, validation, and test seed splits. The optimizer evaluates candidates on the training seeds, selects the reported winner on validation seeds, and reports test metrics on held-out test seeds. Use `--skip-seed-splits` only when you want faster exploratory history logging and do not need validation/test re-evaluation.

For PCA/strategy-space data only, skip the repeated tests:

```bash
node run_headless_experiments.js \
  --out results/pca-only \
  --skip-repeated
```

To run the larger comparison suite requested for the final analysis:

```bash
node run_headless_experiments.js \
  --out results/comparison-suite \
  --comparison-suite
```

This runs two experiment groups:

```text
same-parameters: 5 GA seeds and 5 CMA-ES seeds with identical controlled hyperparameters
hyperparameters: 5 controlled hyperparameter variants for GA and CMA-ES
```

Use `--skip-repeated` with the comparison suite if you only need optimizer history for PCA/strategy-space plots.

For a much faster PCA-oriented run, skip repeated tests and skip final validation/test seed re-evaluations:

```bash
node run_headless_experiments.js \
  --out results/pca-fast \
  --pca-fast
```

This runs 5 GA seeds and 5 CMA-ES seeds with the same hyperparameters. It uses one training seed and 300 simulation steps per optimizer evaluation by default. The resulting fitness values are rougher, but the optimizer history is enough for PCA, t-SNE, scatter matrices, or parallel-coordinate plots of the explored weight space.

To include the hyperparameter variants in the faster PCA-oriented run:

```bash
node run_headless_experiments.js \
  --out results/pca-fast-suite \
  --comparison-suite \
  --pca-fast
```

## Recommended Experiment Workflow

1. Choose optimizer settings for GA or CMA-ES.
2. Run the optimizer.
3. Apply the best weights found by the optimizer.
4. Run a repeated test, for example 100 runs with 5000 steps per run.
5. Export the repeated-test results as CSV.
6. Export optimizer weights and optimizer history from the optimizer results panel.
7. Repeat the same process for the other optimizer.
8. Use `plot_optimizer_runs.py` to compare the run-by-run metrics.

For fair comparisons, use the same repeated-test seed and number of runs for GA and CMA-ES.

The optimizer history CSV contains one row per evaluated individual:

```text
method, experimentGroup, configName, optimizerRun, optimizerSeed,
generation, individual, rank, populationSize, evaluation,
trainingSeeds, targetChanges, maxSteps, parameterKeys,
population, gaGenerations, cmaGenerations, gaMutation, gaSelection, cmaSigma,
fitness, cost, meanFitness, fitnessStd, targetScore, formationScore, constraintScore,
targets, targetTime, order, nn, spacingScore, cluster, collisionRate, sigma,
cohesion, alignment, separation, targetWeight, avoidance, leaderFollowWeight
```

This file is intended for PCA, t-SNE, scatter matrices, or parallel-coordinate plots of the explored strategy space.

To plot the optimizer strategy space from the history CSV:

```bash
python3 plot_strategy_space.py \
  results/pca-fast/optimizer_history.csv \
  --out-dir results/pca-fast/strategy_space_6d
```

Install `requirements.txt` before running `plot_strategy_space.py`, because the PCA plots use NumPy and Pillow.

The analysis uses the full 6-dimensional strategy vector:

```text
cohesion, alignment, separation, targetWeight, avoidance, leaderFollowWeight
```

The script writes SVG and PNG versions of the 6D PCA plots, separate GA/CMA-ES PCA plots using the same global PCA axes, a weight pair scatter matrix, PCA coordinates, and a summary CSV.

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
- `targetTime`: average number of simulation steps between successful target completions.
- `order`: alignment/order of the flock.
- `nn`: average nearest-neighbor distance.
- `spacingScore`: score for avoiding collapse into a tight blob.
- `cluster`: largest connected flock fraction.
- `collisionRate`: fraction of boid-obstacle collisions.
- `targetScore`: target-reaching part of the fitness.
- `formationScore`: flock coherence/order part of the fitness.
- `constraintScore`: combined formation and spacing constraint score.
