"use strict";

let running = true;
let lastMetricsUpdate = -Infinity;
let optimizerRows = [];
let batchRows = [];
let batchRunRows = [];
let preOptimizerWeights = null;
let optimizerRunning = false;
let currentSimulationSource = "Manual";

const METRICS_UPDATE_INTERVAL_MS = 200;
const PAUSED_DRAW_INTERVAL_MS = 250;
const TARGET_WEIGHT_MAX = 1;
const OPTIMIZER_VARIABLES = [
  "cohesion",
  "alignment",
  "separation",
  "targetWeight",
  "avoidance",
  "leaderFollowWeight"
];
const OPTIMIZER_SEED_SPLITS = {
  training: [12345, 23456, 34567, 45678, 56789],
  validation: [67890, 78901, 89012],
  test: [90123, 112233, 445566]
};
const RESERVED_OPTIMIZER_SEEDS = Array.from(new Set(
  Object.keys(OPTIMIZER_SEED_SPLITS).flatMap((split) => OPTIMIZER_SEED_SPLITS[split])
));
const RESERVED_OPTIMIZER_SEED_SET = new Set(RESERVED_OPTIMIZER_SEEDS);
const OPTIMIZER_RANGE_PAIRS = [
  ["gaVarsSlider", "gaVars"],
  ["gaIterationsSlider", "gaIterations"],
  ["gaPopulationSlider", "gaPopulation"],
  ["gaMutationSlider", "gaMutation"],
  ["gaSelectionSlider", "gaSelection"],
  ["gaRobustnessSlider", "gaRobustness"],
  ["gaTrainingSeedsSlider", "gaTrainingSeeds"],
  ["gaTargetChangesSlider", "gaTargetChanges"],
  ["cmaVarsSlider", "cmaVars"],
  ["cmaGenerationsSlider", "cmaGenerations"],
  ["cmaPopulationSlider", "cmaPopulation"],
  ["cmaSigmaSlider", "cmaSigma"],
  ["cmaRobustnessSlider", "cmaRobustness"],
  ["cmaTrainingSeedsSlider", "cmaTrainingSeeds"],
  ["cmaTargetChangesSlider", "cmaTargetChanges"]
];

let rangeMap = {
  wa: {
    key: "alignment",
    rangeToModel: (v) => v,
    modelToRange: (v) => v,
    bubbleText: (v) => v.toFixed(3)
  },
  wc: {
    key: "cohesion",
    rangeToModel: (v) => v,
    modelToRange: (v) => v,
    bubbleText: (v) => v.toFixed(3)
  },
  ws: {
    key: "separation",
    rangeToModel: (v) => v,
    modelToRange: (v) => v,
    bubbleText: (v) => v.toFixed(3)
  },
  wt: {
    key: "targetWeight",
    rangeToModel: (v) => v,
    modelToRange: (v) => v,
    bubbleText: (v) => v.toFixed(3)
  },
  wo: {
    key: "avoidance",
    rangeToModel: (v) => v,
    modelToRange: (v) => v,
    bubbleText: (v) => v.toFixed(3)
  },
  wl: {
    key: "leaderFollowWeight",
    rangeToModel: (v) => v,
    modelToRange: (v) => v,
    bubbleText: (v) => v.toFixed(3)
  },
  wr: {
    key: "randomWeight",
    rangeToModel: (v) => v,
    modelToRange: (v) => v,
    bubbleText: (v) => v.toFixed(3)
  },
  rSep: {
    key: "separationRadius",
    rangeToModel: (v) => v,
    modelToRange: (v) => v,
    bubbleText: (v) => v.toFixed(0)
  },
  rInt: {
    key: "interactionRadius",
    rangeToModel: (v) => v,
    modelToRange: (v) => v,
    bubbleText: (v) => v.toFixed(0)
  },
  rObs: {
    key: "obstaclePerceptionRadius",
    rangeToModel: (v) => v,
    modelToRange: (v) => v,
    bubbleText: (v) => v.toFixed(0)
  }
};

function setupUI() {
  const seedInput = document.getElementById("testSeed");
  const stepsInput = document.getElementById("batchSteps");
  if (seedInput) seedInput.value = S.conf.seed;
  if (stepsInput) stepsInput.value = S.conf.maxSteps;

  for (const id of Object.keys(rangeMap)) {
    const slider = document.getElementById(id);
    if (slider) slider.addEventListener("input", sliderInput);
  }

  bindClick("playPause", function() {
    running = !running;
    setPlayPause();
  });
  bindClick("reset", function() {
    resetSim();
  });
  bindClick("newTarget", function() {
    newTarget();
  });
  bindClick("downloadScene", function() {
    downloadSceneScreenshot();
  });
  bindClick("applySeed", function() {
    applySeedFromUI();
  });
  bindClick("runBatch", function() {
    runBatchFromUI();
  });
  bindClick("gaRun", function() {
    runGAFromUI();
  });
  bindClick("cmaRun", function() {
    runCMAFromUI();
  });
  bindClick("restorePreRunWeights", function() {
    restorePreRunWeights();
  });
  bindClick("exportJSON", function() {
    exportResultsJSON();
  });
  bindClick("exportCSV", function() {
    exportResultsCSV();
  });
  bindClick("exportOptimizerJSON", function() {
    exportOptimizerResultsJSON();
  });
  bindClick("exportOptimizerCSV", function() {
    exportOptimizerResultsCSV();
  });
  bindRangeNumberPairs(OPTIMIZER_RANGE_PAIRS);
  syncNumberInputs(["gaTrainingSeeds", "cmaTrainingSeeds"]);
  syncNumberInputs(["gaTargetChanges", "cmaTargetChanges"]);

  setSliders();
  setBatchSource(currentSimulationSource);
  setPlayPause();
  updateRestoreWeightsButton();
  updateMetrics();
  renderBatchResultsTable();
  renderOptimizerResultsTable();
}

function bindClick(id, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener("click", handler);
}

function syncNumberInputs(ids) {
  const inputs = ids
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  for (const input of inputs) {
    input.addEventListener("input", function() {
      for (const other of inputs) {
        if (other !== input) {
          other.value = input.value;
          syncRangeForNumberInput(other);
        }
      }
    });
  }
}

function bindRangeNumberPairs(pairs) {
  for (const [rangeId, numberId] of pairs) {
    const range = document.getElementById(rangeId);
    const number = document.getElementById(numberId);
    if (!range || !number) continue;

    const syncRangeToNumber = function() {
      number.value = range.value;
      number.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const syncNumberToRange = function() {
      const value = clampNumericString(number.value, number.min, number.max);
      number.value = value;
      range.value = value;
    };

    range.addEventListener("input", syncRangeToNumber);
    number.addEventListener("input", syncNumberToRange);
    syncNumberToRange();
  }
}

function clampNumericString(value, minValue, maxValue) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return value;

  let clamped = parsed;
  const min = Number.parseFloat(minValue);
  const max = Number.parseFloat(maxValue);
  if (Number.isFinite(min)) clamped = Math.max(min, clamped);
  if (Number.isFinite(max)) clamped = Math.min(max, clamped);

  return String(clamped);
}

function syncRangeForNumberInput(numberInput) {
  if (!numberInput || !numberInput.id) return;

  for (const [rangeId, numberId] of OPTIMIZER_RANGE_PAIRS) {
    if (numberId !== numberInput.id) continue;

    const range = document.getElementById(rangeId);
    if (range) range.value = numberInput.value;
  }
}

function step(timestamp) {
  const now = typeof timestamp === "number" ? timestamp : 0;

  if (running) {
    S.step();
  }

  if (
    running ||
    typeof timestamp === "undefined" ||
    now - (step.lastCanvasDraw || -Infinity) >= PAUSED_DRAW_INTERVAL_MS
  ) {
    canvas.drawSwarm();
    step.lastCanvasDraw = now;
  }

  if (
    typeof timestamp === "undefined" ||
    now - lastMetricsUpdate >= METRICS_UPDATE_INTERVAL_MS
  ) {
    updateMetrics();
    lastMetricsUpdate = now;
  }

  requestAnimationFrame(step);
}

function setMetric(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatMetric(value, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function formatStep(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "-";
  return Math.round(value).toString();
}

function updateMetrics() {
  if (!S || typeof S.computeFitness !== "function") return;

  const metrics = S.computeFitness();
  const targetChangedAt = Number.isFinite(S.targetChangedAt) ? S.targetChangedAt : 0;
  const currentTargetAge = Math.max(0, S.time - targetChangedAt);

  setMetric("time", S.time);
  setMetric("targetArrivalSuccess", formatMetric(metrics.targetArrivalSuccess, 3));
  setMetric("targetCompletions", metrics.targetCompletionCount);
  setMetric("currentTargetAge", formatStep(currentTargetAge));
  setMetric("lastTargetInterval", formatStep(metrics.lastTargetChangeInterval));
  setMetric("averageTargetInterval", formatMetric(metrics.averageTargetChangeInterval, 1));
  setMetric("orderParameter", formatMetric(metrics.orderParameter, 3));
  setMetric("largestClusterFraction", formatMetric(metrics.largestClusterFraction, 3));
  setMetric("collisionRate", formatMetric(metrics.collisionRate, 4));
}

function clampSliderValue(slider, value) {
  const min = Number.parseFloat(slider.min);
  const max = Number.parseFloat(slider.max);
  if (Number.isFinite(min)) value = Math.max(min, value);
  if (Number.isFinite(max)) value = Math.min(max, value);
  return value;
}

function updateBubble(slider, map) {
  const bubble = slider.parentElement.querySelector(".bubble");
  if (!bubble) return;
  const value = Number.parseFloat(slider.value);
  bubble.textContent = map.bubbleText ? map.bubbleText(value) : value;
}

function setSliders() {
  for (const id of Object.keys(rangeMap)) {
    const slider = document.getElementById(id);
    if (!slider || !S || !S.conf) continue;

    const map = rangeMap[id];
    const modelValue = S.conf[map.key];
    const sliderValue = clampSliderValue(slider, map.modelToRange(modelValue));
    slider.value = sliderValue;
    updateBubble(slider, map);
  }

  if (S && typeof S.clearMetricCache === "function") {
    S.clearMetricCache();
  }
}

function sliderInput() {
  for (const id of Object.keys(rangeMap)) {
    const slider = document.getElementById(id);
    if (!slider) continue;

    const map = rangeMap[id];
    const sliderValue = Number.parseFloat(slider.value);
    const modelValue = map.rangeToModel(sliderValue);
    S.conf[map.key] = modelValue;
    conf[map.key] = modelValue;
    updateBubble(slider, map);
  }

  if (S && typeof S.clearMetricCache === "function") {
    S.clearMetricCache();
  }

  updateMetrics();
  canvas.drawSwarm();
  setBatchSource("Custom");
}

function numericInputValue(id, fallback, min = -Infinity, max = Infinity) {
  const input = document.getElementById(id);
  const value = input ? Number.parseInt(input.value, 10) : fallback;
  const safe = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, safe));
}

function numericFloatInputValue(id, fallback, min = -Infinity, max = Infinity) {
  const input = document.getElementById(id);
  const value = input ? Number.parseFloat(input.value) : fallback;
  const safe = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, safe));
}

function getTestSeed() {
  return numericInputValue("testSeed", conf.seed, 1, 2147483646);
}

function getBatchRuns() {
  return numericInputValue("batchRuns", 10, 1, 100);
}

function getBatchSteps() {
  return numericInputValue("batchSteps", conf.maxSteps, 1, 100000);
}

function seedForRun(baseSeed, index) {
  return 1 + ((baseSeed + index * 1009 - 1) % 2147483646);
}

function isReservedOptimizerSeed(seed) {
  return RESERVED_OPTIMIZER_SEED_SET.has(Math.round(seed));
}

function nextAvailableSimulationSeed(seed) {
  let candidate = Math.max(1, Math.min(2147483646, Math.round(seed)));
  let attempts = 0;

  while (isReservedOptimizerSeed(candidate) && attempts < 10000) {
    candidate = seedForRun(candidate, 1);
    attempts++;
  }

  return candidate;
}

function evaluationSeedsFromUI() {
  const baseSeed = getTestSeed();
  const runs = getBatchRuns();
  const seeds = [];
  let attempt = 0;

  while (seeds.length < runs && attempt < runs + RESERVED_OPTIMIZER_SEEDS.length + 1000) {
    const candidate = seedForRun(baseSeed, attempt);
    if (!isReservedOptimizerSeed(candidate) && !seeds.includes(candidate)) {
      seeds.push(candidate);
    }
    attempt++;
  }

  return seeds;
}

function optimizerSeedProtocol(trainingCount) {
  const count = Math.max(
    1,
    Math.min(OPTIMIZER_SEED_SPLITS.training.length, Math.round(trainingCount))
  );
  return {
    training: OPTIMIZER_SEED_SPLITS.training.slice(0, count),
    validation: OPTIMIZER_SEED_SPLITS.validation.slice(),
    test: OPTIMIZER_SEED_SPLITS.test.slice()
  };
}

function splitMetricsSummary(result) {
  const metrics = result.metrics || {};
  return {
    fitness: result.fitness,
    cost: result.cost,
    fitnessStd: metrics.fitnessStd,
    targetCompletionCount: metrics.targetCompletionCount,
    averageTargetChangeInterval: metrics.averageTargetChangeInterval,
    orderParam: metrics.orderParam,
    orderParamStd: metrics.orderParamStd,
    meanNearestNeighborDistance: metrics.meanNearestNeighborDistance,
    meanNearestNeighborDistanceStd: metrics.meanNearestNeighborDistanceStd,
    spacingScore: metrics.spacingScore,
    largestClusterFraction: metrics.largestClusterFraction,
    collisionRate: metrics.collisionRate
  };
}

function optimizerCandidateSignature(weights, parameterKeys) {
  return parameterKeys.map((key) => {
    const value = weights && Object.prototype.hasOwnProperty.call(weights, key)
      ? weights[key]
      : "";
    return key + ":" + Number(value).toPrecision(12);
  }).join("|");
}

function optimizerValidationCandidates(result, parameterKeys) {
  const candidates = [];
  const seen = new Set();

  const addCandidate = function(label, weights, fitness, cost, metrics) {
    if (!weights) return;

    const signature = optimizerCandidateSignature(weights, parameterKeys);
    if (seen.has(signature)) return;

    seen.add(signature);
    candidates.push({
      label: label,
      weights: Object.assign({}, weights),
      fitness: fitness,
      cost: cost,
      metrics: Object.assign({}, metrics || {})
    });
  };

  addCandidate("final", result.weights, result.fitness, result.cost, result.metrics);

  if (Array.isArray(result.history)) {
    for (const entry of result.history) {
      addCandidate(
        "generation " + entry.generation,
        entry.bestWeights,
        entry.bestFitness,
        entry.bestCost,
        entry.metrics
      );
    }
  }

  return candidates;
}

async function selectOptimizerCandidateByValidation(result, options, method, protocol, parameterKeys) {
  const candidates = optimizerValidationCandidates(result, parameterKeys);
  let best = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidates.length > 1) {
      setStatus(method + " validation selection " + (i + 1) + "/" + candidates.length + ".");
    }

    const validationResult = await evaluateWeightsOnSeeds(
      candidate.weights,
      parameterKeys,
      options,
      protocol.validation
    );
    const validationSummary = splitMetricsSummary(validationResult);

    if (!best || validationSummary.fitness > best.validationSummary.fitness) {
      best = {
        candidate: candidate,
        validationResult: validationResult,
        validationSummary: validationSummary
      };
    }
  }

  if (best) best.candidateCount = candidates.length;
  return best;
}

function setStatus(message) {
  const status = document.getElementById("runStatus");
  if (status) status.textContent = message;
}

function setBatchSource(source) {
  currentSimulationSource = source || "Custom";
  const input = document.getElementById("batchSource");
  if (input) input.value = currentSimulationSource;
}

function getBatchSource() {
  const input = document.getElementById("batchSource");
  return input && input.value ? input.value : currentSimulationSource;
}

function snapshotCurrentOptimizerWeights() {
  const source = S && S.conf ? S.conf : conf;
  const weights = {};

  for (const key of OPTIMIZER_VARIABLES) {
    weights[key] = source[key];
  }

  return weights;
}

function rememberPreRunWeights() {
  preOptimizerWeights = snapshotCurrentOptimizerWeights();
  updateRestoreWeightsButton();
}

function updateRestoreWeightsButton() {
  const button = document.getElementById("restorePreRunWeights");
  if (!button) return;

  button.disabled = optimizerRunning || !preOptimizerWeights;
}

function restorePreRunWeights() {
  if (!preOptimizerWeights) {
    setStatus("No pre-run weights saved yet.");
    return;
  }

  applyWeightsToSimulation(preOptimizerWeights, { reset: true, restart: false });
  setBatchSource("Custom");
  setStatus("Restored the weights saved before the last optimizer run.");
}

function applySeedFromUI() {
  const requestedSeed = getTestSeed();
  const seed = nextAvailableSimulationSeed(requestedSeed);
  const seedInput = document.getElementById("testSeed");
  if (seedInput && seed !== requestedSeed) {
    seedInput.value = seed;
  }
  conf.seed = seed;
  S.conf.seed = seed;
  resetSim();
  setStatus(seed === requestedSeed
    ? "Applied seed " + seed + "."
    : "Skipped reserved optimizer seed " + requestedSeed + "; applied seed " + seed + "."
  );
}

function resetSim() {
  running = false;
  S.reset();
  setSliders();
  updateMetrics();
  canvas.drawSwarm();
  setPlayPause();
}

function newTarget() {
  S.generateNewTarget();
  updateMetrics();
  canvas.drawSwarm();
}

function setPlayPause() {
  const playIcon = document.getElementById("playIcon");
  const playPause = document.getElementById("playPause");
  if (playIcon) playIcon.textContent = running ? "Pause" : "Play";
  if (playPause) playPause.setAttribute("aria-label", running ? "Pause simulation" : "Play simulation");
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => Math.pow(value - avg, 2))));
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function runSceneForSummary(seed, steps, weights = {}) {
  const sceneConf = Object.assign({}, conf, weights, {
    seed: seed,
    maxSteps: steps,
    targetVisibleBoids: 1,
    autoRetargetOnMajority: true
  });
  const scene = new Scene(sceneConf);

  for (let i = 0; i < steps; i++) {
    scene.step();
  }

  return scene.computeFitness();
}

function metricValue(metric, key, fallback = 0) {
  const value = metric[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function runMetricsRecord(metric, source, runIndex, seed, steps) {
  const targetInterval = metric.targetCompletionCount > 0 && metric.averageTargetChangeInterval > 0
    ? metric.averageTargetChangeInterval
    : steps;

  return {
    source: source,
    runIndex: runIndex,
    seed: seed,
    steps: steps,
    fitness: metricValue(metric, "fitness"),
    targets: metricValue(metric, "targetCompletionCount"),
    targetTime: targetInterval,
    order: metricValue(metric, "orderParameter"),
    nn: metricValue(metric, "meanNearestNeighborDistance"),
    spacingScore: metricValue(metric, "spacingScore"),
    cluster: metricValue(metric, "largestClusterFraction"),
    collisionRate: metricValue(metric, "collisionRate"),
    targetScore: metricValue(metric, "targetScore"),
    formationScore: metricValue(metric, "formationScore"),
    constraintScore: metricValue(metric, "constraintScore")
  };
}

function summarizeRunMetrics(metricsList, seed, steps, source) {
  const targetCounts = metricsList.map((m) => m.targetCompletionCount || 0);
  const fitnessValues = metricsList.map((m) => m.fitness || 0);
  const orderValues = metricsList.map((m) => m.orderParameter || 0);
  const nnValues = metricsList.map((m) => m.meanNearestNeighborDistance || 0);
  const spacingValues = metricsList.map((m) => m.spacingScore || 0);
  const clusterValues = metricsList.map((m) => m.largestClusterFraction || 0);
  const collisionValues = metricsList.map((m) => m.collisionRate || 0);
  const targetIntervals = metricsList.map((m) => {
    if (m.targetCompletionCount > 0 && m.averageTargetChangeInterval > 0) {
      return m.averageTargetChangeInterval;
    }
    return steps;
  });

  return {
    source: source,
    seed: seed,
    runs: metricsList.length,
    steps: steps,
    targetsMean: mean(targetCounts),
    targetsStd: standardDeviation(targetCounts),
    intervalMean: mean(targetIntervals),
    intervalStd: standardDeviation(targetIntervals),
    orderMean: mean(orderValues),
    orderStd: standardDeviation(orderValues),
    nnMean: mean(nnValues),
    nnStd: standardDeviation(nnValues),
    spacingMean: mean(spacingValues),
    spacingStd: standardDeviation(spacingValues),
    clusterMean: mean(clusterValues),
    clusterStd: standardDeviation(clusterValues),
    collisionMean: mean(collisionValues),
    collisionStd: standardDeviation(collisionValues),
    fitnessMean: mean(fitnessValues),
    fitnessStd: standardDeviation(fitnessValues)
  };
}

async function runBatchFromUI() {
  const button = document.getElementById("runBatch");
  const requestedSeed = getTestSeed();
  const seeds = evaluationSeedsFromUI();
  const steps = getBatchSteps();
  const source = getBatchSource();
  const metricsList = [];
  const runRows = [];
  const seedInput = document.getElementById("testSeed");

  if (seedInput && seeds.length > 0 && seeds[0] !== requestedSeed) {
    seedInput.value = seeds[0];
  }

  if (button) button.disabled = true;
  running = false;
  setPlayPause();

  try {
    for (let i = 0; i < seeds.length; i++) {
      setStatus("Repeated test " + (i + 1) + "/" + seeds.length + " on seed " + seeds[i] + ".");
      const metrics = runSceneForSummary(seeds[i], steps);
      metricsList.push(metrics);
      runRows.push(runMetricsRecord(metrics, source, i + 1, seeds[i], steps));
      await yieldToBrowser();
    }

    const summary = summarizeRunMetrics(metricsList, seeds[0] || requestedSeed, steps, source);
    summary.requestedSeed = requestedSeed;
    summary.usedSeeds = seeds.slice();
    summary.reservedSeedsExcluded = RESERVED_OPTIMIZER_SEEDS.slice();
    summary.runRowStart = batchRunRows.length + 1;
    summary.runRowCount = runRows.length;
    batchRows.push(summary);
    batchRunRows.push(...runRows);
    renderBatchResultsTable();
    setStatus("Repeated test complete. Optimizer train/validation/test seeds were excluded.");
  } catch (err) {
    console.error(err);
    setStatus("Repeated test failed: " + err.message);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderBatchResultsTable() {
  const body = document.getElementById("batchResultsBody");
  if (!body) {
    renderRunDetailsTable();
    return;
  }

  if (batchRows.length === 0) {
    body.innerHTML = '<tr><td colspan="17">Run a repeated test to fill this table.</td></tr>';
    renderRunDetailsTable();
    return;
  }

  body.innerHTML = batchRows.map((row) => (
    "<tr>" +
      "<td>" + (row.source || "Manual") + "</td>" +
      "<td>" + row.seed + "</td>" +
      "<td>" + row.runs + "</td>" +
      "<td>" + row.steps + "</td>" +
      "<td>" + formatMetric(row.targetsMean, 2) + "</td>" +
      "<td>" + formatMetric(row.targetsStd, 2) + "</td>" +
      "<td>" + formatMetric(row.intervalMean, 1) + "</td>" +
      "<td>" + formatMetric(row.intervalStd, 1) + "</td>" +
      "<td>" + formatMetric(row.orderMean, 3) + "</td>" +
      "<td>" + formatMetric(row.orderStd, 3) + "</td>" +
      "<td>" + formatMetric(row.nnMean, 2) + "</td>" +
      "<td>" + formatMetric(row.nnStd, 2) + "</td>" +
      "<td>" + formatMetric(row.spacingMean, 3) + "</td>" +
      "<td>" + formatMetric(row.clusterMean, 3) + "</td>" +
      "<td>" + formatMetric(row.collisionMean, 4) + "</td>" +
      "<td>" + formatMetric(row.fitnessMean, 3) + "</td>" +
      "<td>" + formatMetric(row.fitnessStd, 3) + "</td>" +
    "</tr>"
  )).join("");
  renderRunDetailsTable();
}

function renderRunDetailsTable() {
  const body = document.getElementById("runDetailsBody");
  if (!body) return;

  if (batchRunRows.length === 0) {
    body.innerHTML = '<tr><td colspan="12">Run a repeated test to fill this table.</td></tr>';
    return;
  }

  body.innerHTML = batchRunRows.map((row) => (
    "<tr>" +
      "<td>" + (row.source || "Manual") + "</td>" +
      "<td>" + row.runIndex + "</td>" +
      "<td>" + row.seed + "</td>" +
      "<td>" + row.steps + "</td>" +
      "<td>" + formatMetric(row.targets, 0) + "</td>" +
      "<td>" + formatMetric(row.targetTime, 1) + "</td>" +
      "<td>" + formatMetric(row.order, 3) + "</td>" +
      "<td>" + formatMetric(row.nn, 2) + "</td>" +
      "<td>" + formatMetric(row.spacingScore, 3) + "</td>" +
      "<td>" + formatMetric(row.cluster, 3) + "</td>" +
      "<td>" + formatMetric(row.collisionRate, 4) + "</td>" +
      "<td>" + formatMetric(row.fitness, 3) + "</td>" +
    "</tr>"
  )).join("");
}

function optimizerTimestamp() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function optimizerBaseOptions() {
  const steps = getBatchSteps();
  return {
    baseConf: Object.assign({}, conf, {
      seed: getTestSeed(),
      maxSteps: steps,
      targetVisibleBoids: 1,
      autoRetargetOnMajority: true
    }),
    variables: OPTIMIZER_VARIABLES.slice(),
    lowerLimit: 0,
    upperLimit: 1,
    bounds: { targetWeight: [0, TARGET_WEIGHT_MAX] },
    maxSteps: steps,
    autoRetargetOnMajority: true,
    yieldEverySteps: 100
  };
}

function gaOptionsFromUI() {
  const seedProtocol = optimizerSeedProtocol(numericInputValue("gaTrainingSeeds", 3, 1, 5));
  return Object.assign(optimizerBaseOptions(), {
    numberOfVariables: numericInputValue("gaVars", 6, 1, OPTIMIZER_VARIABLES.length),
    maximumIterations: numericInputValue("gaIterations", 12, 1, 200),
    minimumCost: 0,
    populationSize: numericInputValue("gaPopulation", 8, 3, 100),
    mutationRate: numericFloatInputValue("gaMutation", 0.2, 0, 1),
    selectionRate: numericFloatInputValue("gaSelection", 0.5, 0.1, 1),
    robustnessPenalty: numericFloatInputValue("gaRobustness", 0.15, 0, 1),
    evaluationSeeds: seedProtocol.training,
    seedProtocol: seedProtocol,
    targetChanges: numericInputValue("gaTargetChanges", 0, 0, 10),
    seed: numericInputValue("gaSeed", seedForRun(getTestSeed(), 500), 1, 2147483646)
  });
}

function cmaOptionsFromUI() {
  const seedProtocol = optimizerSeedProtocol(numericInputValue("cmaTrainingSeeds", 3, 1, 5));
  return Object.assign(optimizerBaseOptions(), {
    numberOfVariables: numericInputValue("cmaVars", 6, 2, OPTIMIZER_VARIABLES.length),
    maxGenerations: numericInputValue("cmaGenerations", 12, 1, 200),
    populationSize: numericInputValue("cmaPopulation", 8, 4, 100),
    sigma0: numericFloatInputValue("cmaSigma", 0.25, 0.01, 1),
    robustnessPenalty: numericFloatInputValue("cmaRobustness", 0.15, 0, 1),
    evaluationSeeds: seedProtocol.training,
    seedProtocol: seedProtocol,
    targetChanges: numericInputValue("cmaTargetChanges", 0, 0, 10),
    seed: numericInputValue("cmaSeed", seedForRun(getTestSeed(), 700), 1, 2147483646)
  });
}

function setOptimizerButtonsDisabled(disabled) {
  const gaButton = document.getElementById("gaRun");
  const cmaButton = document.getElementById("cmaRun");
  optimizerRunning = disabled;
  if (gaButton) gaButton.disabled = disabled;
  if (cmaButton) cmaButton.disabled = disabled;
  updateRestoreWeightsButton();
}

function pauseSimulationForOptimizer() {
  running = false;
  setPlayPause();
}

function setOptimizerProgress(percent, text) {
  const panel = document.getElementById("optimizerProgress");
  const bar = document.getElementById("optimizerProgressBar");
  const label = document.getElementById("optimizerProgressText");
  const safePercent = Math.max(0, Math.min(100, percent || 0));

  if (panel) panel.hidden = false;
  if (bar) bar.style.width = safePercent.toFixed(1) + "%";
  if (label) label.textContent = safePercent.toFixed(1) + "% - " + text;
}

function optimizerPopulationCount(method, options) {
  return method === "GA"
    ? (options.maximumIterations || 0) + 1
    : options.maxGenerations || 0;
}

function optimizerProgressPercent(method, progress, options) {
  const populationBatches = Math.max(1, optimizerPopulationCount(method, options));
  const populationSize = Math.max(1, progress.populationSize || options.populationSize || 1);
  const seedCount = Math.max(1, progress.seedCount || (options.evaluationSeeds || []).length || 1);
  const maxSteps = Math.max(1, progress.maxSteps || options.maxSteps || getBatchSteps());
  const generation = Math.max(0, progress.generation || 0);
  const individual = Math.max(1, progress.individual || 1);

  if (progress.phase === "evaluating") {
    const completed =
      generation * populationSize * seedCount * maxSteps +
      (individual - 1) * seedCount * maxSteps +
      Math.max(0, (progress.seedIndex || 1) - 1) * maxSteps +
      Math.max(0, progress.step || 0);
    const total = populationBatches * populationSize * seedCount * maxSteps;
    return 100 * completed / total;
  }

  if (progress.phase === "individual") {
    const completed = generation * populationSize + individual;
    return 100 * completed / (populationBatches * populationSize);
  }

  if (progress.phase === "generation") {
    return 100 * Math.min(populationBatches, generation + 1) / populationBatches;
  }

  return 0;
}

function optimizerProgressLabel(method, progress, options) {
  const populationBatches = Math.max(1, optimizerPopulationCount(method, options));
  const batch = Math.min(populationBatches, Math.max(1, (progress.generation || 0) + 1));
  const populationSize = progress.populationSize || options.populationSize || "?";

  if (progress.phase === "evaluating") {
    return method + " population " + batch + "/" + populationBatches +
      ", individual " + (progress.individual || "?") + "/" + populationSize +
      ", seed " + (progress.seedIndex || "?") + "/" + (progress.seedCount || "?") +
      ", step " + (progress.step || "?") + "/" + (progress.maxSteps || options.maxSteps || getBatchSteps()) + ".";
  }

  if (progress.phase === "individual") {
    return method + " population " + batch + "/" + populationBatches +
      ", individual " + progress.individual + "/" + populationSize +
      ". Fitness " + formatMetric(progress.fitness, 4) + ".";
  }

  if (progress.phase === "generation") {
    return method + " population " + batch + "/" + populationBatches +
      " complete. Best fitness " + formatMetric(progress.bestFitness, 4) + ".";
  }

  return method + " running.";
}

function updateOptimizerProgress(method, progress, options) {
  const percent = optimizerProgressPercent(method, progress, options);
  const label = optimizerProgressLabel(method, progress, options);
  setOptimizerProgress(percent, label);
}

async function evaluateWeightsOnSeeds(weights, parameterKeys, options, seeds) {
  if (typeof BoidsGAOptimizer === "undefined") {
    throw new Error("GA evaluator is not loaded.");
  }

  const keys = parameterKeys && parameterKeys.length > 0
    ? parameterKeys.slice()
    : Object.keys(weights || {});
  const evaluator = new BoidsGAOptimizer({
    baseConf: Object.assign({}, options.baseConf || conf),
    variables: keys,
    numberOfVariables: keys.length,
    evaluationSeeds: seeds.slice(),
    targetChanges: options.targetChanges,
    robustnessPenalty: options.robustnessPenalty,
    maxSteps: options.maxSteps,
    autoRetargetOnMajority: options.autoRetargetOnMajority,
    yieldEverySteps: options.yieldEverySteps || 100
  });
  const genome = evaluator.weightsToGenome(weights);
  return await evaluator.evaluateGenomeAsync(genome);
}

async function attachSeedSplitMetrics(result, options, method) {
  const protocol = options.seedProtocol || optimizerSeedProtocol(3);
  const parameterKeys = result.parameterKeys || options.variables || Object.keys(result.weights || {});
  const selected = await selectOptimizerCandidateByValidation(
    result,
    options,
    method,
    protocol,
    parameterKeys
  );

  if (selected) {
    result.weights = Object.assign({}, selected.candidate.weights);
    result.fitness = selected.candidate.fitness;
    result.cost = selected.candidate.cost;
    result.metrics = Object.assign({}, selected.candidate.metrics);
    result.validationSelection = {
      selected: selected.candidate.label,
      candidateCount: selected.candidateCount,
      validationFitness: selected.validationSummary.fitness
    };
  }

  result.seedProtocol = {
    training: protocol.training.slice(),
    validation: protocol.validation.slice(),
    test: protocol.test.slice()
  };
  result.seedSplitMetrics = {
    training: splitMetricsSummary(result)
  };

  result.seedSplitMetrics.validation = selected
    ? selected.validationSummary
    : splitMetricsSummary(result);

  setStatus(method + " test seeds: " + protocol.test.join(", ") + ".");
  const testResult = await evaluateWeightsOnSeeds(
    result.weights,
    parameterKeys,
    options,
    protocol.test
  );
  result.seedSplitMetrics.test = splitMetricsSummary(testResult);

  return result;
}

async function runGAFromUI() {
  if (typeof runBoidsGAOptimizationAsync !== "function") {
    throw new Error("GA optimizer is not loaded.");
  }

  const options = gaOptionsFromUI();
  const startedAt = optimizerTimestamp();
  rememberPreRunWeights();
  pauseSimulationForOptimizer();
  setOptimizerButtonsDisabled(true);
  setOptimizerProgress(
    0,
    "Starting GA with population " + options.populationSize +
      ", " + options.evaluationSeeds.length + " training seeds."
  );
  setStatus("Starting GA.");

  options.onProgress = function(progress) {
    updateOptimizerProgress("GA", progress, options);
  };

  try {
    const result = await runBoidsGAOptimizationAsync(options);
    await attachSeedSplitMetrics(result, options, "GA");
    applyWeightsToSimulation(result.weights, { reset: true, restart: true, source: "GA" });
    recordOptimizerResult("GA", result, optimizerTimestamp() - startedAt);
    setOptimizerProgress(100, "GA complete. Validation/test metrics computed on fixed seeds.");
    setStatus("GA complete. Validation/test metrics computed on fixed seeds.");
  } catch (err) {
    console.error(err);
    setOptimizerProgress(0, "GA failed: " + err.message);
    setStatus("GA failed: " + err.message);
  } finally {
    setOptimizerButtonsDisabled(false);
  }
}

async function runCMAFromUI() {
  if (typeof runBoidsCMAESOptimizationAsync !== "function") {
    throw new Error("CMA-ES optimizer is not loaded.");
  }

  const options = cmaOptionsFromUI();
  const startedAt = optimizerTimestamp();
  rememberPreRunWeights();
  pauseSimulationForOptimizer();
  setOptimizerButtonsDisabled(true);
  setOptimizerProgress(
    0,
    "Starting CMA-ES with population " + options.populationSize +
      ", " + options.evaluationSeeds.length + " training seeds."
  );
  setStatus("Starting CMA-ES.");

  options.onProgress = function(progress) {
    updateOptimizerProgress("CMA-ES", progress, options);
  };

  try {
    const result = await runBoidsCMAESOptimizationAsync(options);
    await attachSeedSplitMetrics(result, options, "CMA-ES");
    applyWeightsToSimulation(result.weights, { reset: true, restart: true, source: "CMA-ES" });
    recordOptimizerResult("CMA-ES", result, optimizerTimestamp() - startedAt);
    setOptimizerProgress(100, "CMA-ES complete. Validation/test metrics computed on fixed seeds.");
    setStatus("CMA-ES complete. Validation/test metrics computed on fixed seeds.");
  } catch (err) {
    console.error(err);
    setOptimizerProgress(0, "CMA-ES failed: " + err.message);
    setStatus("CMA-ES failed: " + err.message);
  } finally {
    setOptimizerButtonsDisabled(false);
  }
}

function recordOptimizerResult(method, result, runtimeMs) {
  const metrics = result.metrics || {};
  const splitMetrics = result.seedSplitMetrics || {};
  const trainingMetrics = splitMetrics.training || splitMetricsSummary(result);
  const validationMetrics = splitMetrics.validation || {};
  const testMetrics = splitMetrics.test || validationMetrics || trainingMetrics;
  optimizerRows.push({
    method: method,
    trainFitness: trainingMetrics.fitness,
    validationFitness: validationMetrics.fitness,
    testFitness: testMetrics.fitness,
    fitnessStd: testMetrics.fitnessStd ?? metrics.fitnessStd,
    targetCompletionCount: testMetrics.targetCompletionCount,
    averageTargetChangeInterval: testMetrics.averageTargetChangeInterval,
    orderParam: testMetrics.orderParam,
    orderParamStd: testMetrics.orderParamStd,
    meanNearestNeighborDistance: testMetrics.meanNearestNeighborDistance,
    meanNearestNeighborDistanceStd: testMetrics.meanNearestNeighborDistanceStd,
    spacingScore: testMetrics.spacingScore,
    largestClusterFraction: testMetrics.largestClusterFraction,
    collisionRate: testMetrics.collisionRate,
    runtimeSeconds: runtimeMs / 1000,
    evaluations: result.evaluations || 0,
    weights: Object.assign({}, result.weights || {}),
    parameterKeys: (result.parameterKeys || []).slice(),
    validationSelection: result.validationSelection,
    seedProtocol: result.seedProtocol,
    seedSplitMetrics: splitMetrics
  });
  renderOptimizerResultsTable();
}

function renderOptimizerResultsTable() {
  const body = document.getElementById("optimizerResultsBody");
  if (!body) return;

  if (optimizerRows.length === 0) {
    body.innerHTML = '<tr><td colspan="13">Run GA or CMA-ES to fill this table.</td></tr>';
    return;
  }

  body.innerHTML = optimizerRows.map((row) => (
    "<tr>" +
      "<td>" + row.method + "</td>" +
      "<td>" + formatMetric(row.trainFitness, 4) + "</td>" +
      "<td>" + formatMetric(row.validationFitness, 4) + "</td>" +
      "<td>" + formatMetric(row.testFitness, 4) + "</td>" +
      "<td>" + formatMetric(row.fitnessStd, 4) + "</td>" +
      "<td>" + formatMetric(row.targetCompletionCount, 2) + "</td>" +
      "<td>" + formatMetric(row.averageTargetChangeInterval, 1) + "</td>" +
      "<td>" + formatMetric(row.orderParam, 3) + "</td>" +
      "<td>" + formatMetric(row.meanNearestNeighborDistance, 2) + "</td>" +
      "<td>" + formatMetric(row.largestClusterFraction, 3) + "</td>" +
      "<td>" + formatMetric(row.collisionRate, 4) + "</td>" +
      "<td>" + formatMetric(row.runtimeSeconds, 2) + "s</td>" +
      "<td>" + row.evaluations + "</td>" +
    "</tr>"
  )).join("");
}

function applyWeightsToSimulation(weights, options = {}) {
  if (!weights) {
    throw new Error("No weights were provided.");
  }

  const shouldReset = options.reset !== false;
  const appliedWeights = {};

  for (const key of Object.keys(weights)) {
    if (Object.prototype.hasOwnProperty.call(S.conf, key)) {
      appliedWeights[key] = weights[key];
    }
  }

  Object.assign(S.conf, appliedWeights);
  Object.assign(conf, appliedWeights);

  if (shouldReset) {
    S.reset();
  }

  if (options.restart === true) {
    running = true;
  } else if (shouldReset) {
    running = false;
  }

  setSliders();
  updateMetrics();
  canvas.drawSwarm();
  setPlayPause();
  if (options.source) setBatchSource(options.source);

  return appliedWeights;
}

function exportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function downloadFile(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function() {
    URL.revokeObjectURL(url);
  }, 0);
}

function downloadSceneScreenshot() {
  if (!canvas || !canvas.el) {
    setStatus("No scene is available to capture.");
    return;
  }

  canvas.drawSwarm();
  const filename = "boids-scene-" + exportTimestamp() + ".png";

  if (typeof canvas.el.toBlob === "function") {
    canvas.el.toBlob(function(blob) {
      if (!blob) {
        setStatus("Could not create the scene screenshot.");
        return;
      }
      downloadBlob(filename, blob);
      setStatus("Downloaded scene screenshot.");
    }, "image/png");
    return;
  }

  const link = document.createElement("a");
  link.href = canvas.el.toDataURL("image/png");
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setStatus("Downloaded scene screenshot.");
}

function setExportStatus(message) {
  const status = document.getElementById("exportStatus");
  if (status) status.textContent = message;
}

function setOptimizerExportStatus(message) {
  const status = document.getElementById("optimizerExportStatus");
  if (status) status.textContent = message;
}

function exportResultsJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    optimizerSeedSplits: OPTIMIZER_SEED_SPLITS,
    reservedOptimizerSeeds: RESERVED_OPTIMIZER_SEEDS,
    currentWeights: Object.assign({}, conf),
    repeatedTests: batchRows,
    repeatedTestRuns: batchRunRows,
    optimizerRuns: optimizerRows
  };

  downloadFile(
    "boids-results-" + exportTimestamp() + ".json",
    JSON.stringify(payload, null, 2),
    "application/json"
  );
  setExportStatus("Exported JSON.");
}

function csvValue(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return '"' + value.join("|").replace(/"/g, '""') + '"';
  if (typeof value === "object") return '"' + JSON.stringify(value).replace(/"/g, '""') + '"';
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function optimizerWeightKeys() {
  const keys = [];
  for (const row of optimizerRows) {
    for (const key of Object.keys(row.weights || {})) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function optimizerExportRows() {
  const weightKeys = optimizerWeightKeys();

  return optimizerRows.map((row) => {
    const protocol = row.seedProtocol || {};
    const exported = {
      method: row.method,
      trainFitness: row.trainFitness,
      validationFitness: row.validationFitness,
      testFitness: row.testFitness,
      fitnessStd: row.fitnessStd,
      targets: row.targetCompletionCount,
      averageTargetChangeInterval: row.averageTargetChangeInterval,
      order: row.orderParam,
      orderStd: row.orderParamStd,
      nn: row.meanNearestNeighborDistance,
      nnStd: row.meanNearestNeighborDistanceStd,
      spacingScore: row.spacingScore,
      cluster: row.largestClusterFraction,
      collisions: row.collisionRate,
      runtimeSeconds: row.runtimeSeconds,
      evaluations: row.evaluations,
      parameterKeys: row.parameterKeys || [],
      trainingSeeds: protocol.training || [],
      validationSeeds: protocol.validation || [],
      testSeeds: protocol.test || [],
      validationSelection: row.validationSelection || null
    };

    for (const key of weightKeys) {
      exported["weight_" + key] = row.weights ? row.weights[key] : undefined;
    }

    return exported;
  });
}

function exportOptimizerResultsJSON() {
  if (optimizerRows.length === 0) {
    setOptimizerExportStatus("Run GA or CMA-ES before exporting optimizer results.");
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    optimizerSeedSplits: OPTIMIZER_SEED_SPLITS,
    optimizerRuns: optimizerRows
  };

  downloadFile(
    "boids-optimizer-results-" + exportTimestamp() + ".json",
    JSON.stringify(payload, null, 2),
    "application/json"
  );
  setOptimizerExportStatus("Exported optimizer JSON.");
}

function exportOptimizerResultsCSV() {
  if (optimizerRows.length === 0) {
    setOptimizerExportStatus("Run GA or CMA-ES before exporting optimizer results.");
    return;
  }

  const rows = optimizerExportRows();
  const columns = Object.keys(rows[0]);
  const lines = [columns.map(csvValue).join(",")];

  for (const row of rows) {
    lines.push(columns.map((column) => csvValue(row[column])).join(","));
  }

  downloadFile(
    "boids-optimizer-results-" + exportTimestamp() + ".csv",
    lines.join("\n"),
    "text/csv"
  );
  setOptimizerExportStatus("Exported optimizer CSV.");
}

function exportResultsCSV() {
  const columns = [
    "type",
    "method",
    "source",
    "runIndex",
    "seed",
    "requestedSeed",
    "usedSeeds",
    "runs",
    "steps",
    "fitness",
    "trainFitness",
    "validationFitness",
    "testFitness",
    "fitnessStd",
    "targets",
    "targetsMean",
    "targetsStd",
    "targetTime",
    "targetTimeMean",
    "targetTimeStd",
    "order",
    "orderMean",
    "orderStd",
    "nn",
    "nnMean",
    "nnStd",
    "spacingScore",
    "cluster",
    "collisionRate",
    "targetScore",
    "formationScore",
    "constraintScore",
    "runtimeSeconds",
    "evaluations"
  ];
  const rows = [];

  for (const row of batchRows) {
    rows.push({
      type: "repeated-test",
      method: row.source,
      source: row.source,
      seed: row.seed,
      requestedSeed: row.requestedSeed,
      usedSeeds: (row.usedSeeds || []).join("|"),
      runs: row.runs,
      steps: row.steps,
      fitness: row.fitnessMean,
      trainFitness: row.fitnessMean,
      fitnessStd: row.fitnessStd,
      targetsMean: row.targetsMean,
      targetsStd: row.targetsStd,
      targetTimeMean: row.intervalMean,
      targetTimeStd: row.intervalStd,
      orderMean: row.orderMean,
      orderStd: row.orderStd,
      nnMean: row.nnMean,
      nnStd: row.nnStd,
      spacingScore: row.spacingMean,
      cluster: row.clusterMean,
      collisionRate: row.collisionMean
    });
  }

  for (const row of batchRunRows) {
    rows.push({
      type: "repeated-run",
      method: row.source,
      source: row.source,
      runIndex: row.runIndex,
      seed: row.seed,
      steps: row.steps,
      fitness: row.fitness,
      targets: row.targets,
      targetTime: row.targetTime,
      order: row.order,
      nn: row.nn,
      spacingScore: row.spacingScore,
      cluster: row.cluster,
      collisionRate: row.collisionRate,
      targetScore: row.targetScore,
      formationScore: row.formationScore,
      constraintScore: row.constraintScore
    });
  }

  for (const row of optimizerRows) {
    rows.push({
      type: "optimizer",
      method: row.method,
      source: row.method,
      trainFitness: row.trainFitness,
      validationFitness: row.validationFitness,
      testFitness: row.testFitness,
      fitnessStd: row.fitnessStd,
      targetsMean: row.targetCompletionCount,
      targetTimeMean: row.averageTargetChangeInterval,
      orderMean: row.orderParam,
      orderStd: row.orderParamStd,
      nnMean: row.meanNearestNeighborDistance,
      nnStd: row.meanNearestNeighborDistanceStd,
      spacingScore: row.spacingScore,
      cluster: row.largestClusterFraction,
      collisionRate: row.collisionRate,
      runtimeSeconds: row.runtimeSeconds,
      evaluations: row.evaluations,
      weights: row.weights,
      parameterKeys: row.parameterKeys,
      seedProtocol: row.seedProtocol
    });
  }

  const lines = [columns.map(csvValue).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvValue(row[column])).join(","));
  }

  downloadFile(
    "boids-results-" + exportTimestamp() + ".csv",
    lines.join("\n"),
    "text/csv"
  );
  setExportStatus("Exported CSV.");
}

if (typeof window !== "undefined") {
  window.setupUI = setupUI;
  window.step = step;
  window.sliderInput = sliderInput;
  window.setSliders = setSliders;
  window.setPlayPause = setPlayPause;
  window.applyWeightsToSimulation = applyWeightsToSimulation;
  window.runGAFromUI = runGAFromUI;
  window.runCMAFromUI = runCMAFromUI;
  window.exportResultsJSON = exportResultsJSON;
  window.exportResultsCSV = exportResultsCSV;
  window.exportOptimizerResultsJSON = exportOptimizerResultsJSON;
  window.exportOptimizerResultsCSV = exportOptimizerResultsCSV;
}
