const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DEFAULTS = {
  out: "results/headless-" + new Date().toISOString().replace(/[:.]/g, "-"),
  variables: 6,
  population: 10,
  gaGenerations: 20,
  cmaGenerations: 21,
  gaMutation: 0.2,
  gaSelection: 0.5,
  cmaSigma: 0.25,
  robustness: 0.15,
  trainingSeeds: 3,
  optSteps: 1000,
  repeatedRuns: 100,
  repeatedSteps: 5000,
  testSeed: 12345,
  targetChanges: 0,
  gaSeeds: [24681357, 13579246, 31415926],
  cmaSeeds: [99991357, 27182818, 16180339],
  comparisonSuite: false,
  skipRepeated: false,
  skipSeedSplits: false,
  pcaFast: false,
};

const FIVE_GA_SEEDS = [24681357, 13579246, 31415926, 42424242, 8675309];
const FIVE_CMA_SEEDS = [99991357, 27182818, 16180339, 14142135, 17320508];

function parseArgs(argv) {
  const options = Object.assign({}, DEFAULTS);
  const provided = new Set();
  const aliases = {
    "--out": "out",
    "--variables": "variables",
    "--population": "population",
    "--ga-generations": "gaGenerations",
    "--cma-generations": "cmaGenerations",
    "--ga-mutation": "gaMutation",
    "--ga-selection": "gaSelection",
    "--cma-sigma": "cmaSigma",
    "--robustness": "robustness",
    "--training-seeds": "trainingSeeds",
    "--opt-steps": "optSteps",
    "--repeated-runs": "repeatedRuns",
    "--repeated-steps": "repeatedSteps",
    "--test-seed": "testSeed",
    "--target-changes": "targetChanges",
    "--ga-seeds": "gaSeeds",
    "--cma-seeds": "cmaSeeds",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--comparison-suite") {
      options.comparisonSuite = true;
      provided.add("comparisonSuite");
      continue;
    }
    if (arg === "--skip-repeated") {
      options.skipRepeated = true;
      provided.add("skipRepeated");
      continue;
    }
    if (arg === "--skip-seed-splits") {
      options.skipSeedSplits = true;
      provided.add("skipSeedSplits");
      continue;
    }
    if (arg === "--pca-fast") {
      options.pcaFast = true;
      provided.add("pcaFast");
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    const key = aliases[arg];
    if (!key) {
      throw new Error("Unknown option: " + arg);
    }
    provided.add(key);
    const value = argv[++i];
    if (value === undefined) {
      throw new Error("Missing value for " + arg);
    }
    if (key === "gaSeeds" || key === "cmaSeeds") {
      options[key] = value
        .split(",")
        .map((entry) => parseInt(entry.trim(), 10))
        .filter(Number.isFinite);
    } else if (key === "out") {
      options[key] = value;
    } else {
      options[key] = Number(value);
    }
  }

  if (options.pcaFast) {
    options.skipRepeated = true;
    options.skipSeedSplits = true;
    if (!provided.has("trainingSeeds")) {
      options.trainingSeeds = 1;
    }
    if (!provided.has("optSteps")) {
      options.optSteps = 300;
    }
    if (!provided.has("gaSeeds")) {
      options.gaSeeds = FIVE_GA_SEEDS.slice();
    }
    if (!provided.has("cmaSeeds")) {
      options.cmaSeeds = FIVE_CMA_SEEDS.slice();
    }
  }

  return options;
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  node run_headless_experiments.js [options]",
      "",
      "Defaults run 3 GA seeds and 3 CMA-ES seeds with equal evaluation budget.",
      "",
      "Options:",
      "  --out DIR",
      "  --variables N",
      "  --population N",
      "  --ga-generations N",
      "  --cma-generations N",
      "  --ga-mutation X",
      "  --ga-selection X",
      "  --cma-sigma X",
      "  --robustness X",
      "  --training-seeds N",
      "  --opt-steps N",
      "  --repeated-runs N",
      "  --repeated-steps N",
      "  --test-seed N",
      "  --target-changes N",
      "  --ga-seeds A,B,C",
      "  --cma-seeds A,B,C",
      "  --comparison-suite",
      "  --skip-repeated",
      "  --skip-seed-splits",
      "  --pca-fast",
    ].join("\n"),
  );
}

function configFromOptions(options, overrides = {}) {
  return Object.assign(
    {
      experimentGroup: "single",
      configName: "default",
      variables: options.variables,
      population: options.population,
      gaGenerations: options.gaGenerations,
      cmaGenerations: options.cmaGenerations,
      gaMutation: options.gaMutation,
      gaSelection: options.gaSelection,
      cmaSigma: options.cmaSigma,
      robustness: options.robustness,
      trainingSeeds: options.trainingSeeds,
      optSteps: options.optSteps,
      repeatedRuns: options.repeatedRuns,
      repeatedSteps: options.repeatedSteps,
      testSeed: options.testSeed,
      targetChanges: options.targetChanges,
      gaSeeds: options.gaSeeds.slice(),
      cmaSeeds: options.cmaSeeds.slice(),
    },
    overrides,
  );
}

function buildConfigurations(options) {
  if (!options.comparisonSuite) {
    return [configFromOptions(options)];
  }

  const sameGaSeeds =
    options.gaSeeds.length >= 5
      ? options.gaSeeds.slice(0, 5)
      : FIVE_GA_SEEDS.slice();
  const sameCmaSeeds =
    options.cmaSeeds.length >= 5
      ? options.cmaSeeds.slice(0, 5)
      : FIVE_CMA_SEEDS.slice();
  const gaSeed = sameGaSeeds[0];
  const cmaSeed = sameCmaSeeds[0];
  const base = {
    variables: options.variables,
    robustness: options.robustness,
    trainingSeeds: options.trainingSeeds,
    optSteps: options.optSteps,
    repeatedRuns: options.repeatedRuns,
    repeatedSteps: options.repeatedSteps,
    testSeed: options.testSeed,
    targetChanges: options.targetChanges,
  };

  return [
    configFromOptions(
      options,
      Object.assign({}, base, {
        experimentGroup: "same-parameters",
        configName: "default-five-seeds",
        population: 8,
        gaGenerations: 20,
        cmaGenerations: 21,
        gaMutation: 0.2,
        gaSelection: 0.5,
        cmaSigma: 0.25,
        gaSeeds: sameGaSeeds,
        cmaSeeds: sameCmaSeeds,
      }),
    ),
    configFromOptions(
      options,
      Object.assign({}, base, {
        experimentGroup: "hyperparameters",
        configName: "small-population-longer",
        population: 6,
        gaGenerations: 27,
        cmaGenerations: 28,
        gaMutation: 0.2,
        gaSelection: 0.5,
        cmaSigma: 0.25,
        gaSeeds: [gaSeed],
        cmaSeeds: [cmaSeed],
      }),
    ),
    configFromOptions(
      options,
      Object.assign({}, base, {
        experimentGroup: "hyperparameters",
        configName: "large-population-shorter",
        population: 12,
        gaGenerations: 13,
        cmaGenerations: 14,
        gaMutation: 0.2,
        gaSelection: 0.5,
        cmaSigma: 0.25,
        gaSeeds: [gaSeed],
        cmaSeeds: [cmaSeed],
      }),
    ),
    configFromOptions(
      options,
      Object.assign({}, base, {
        experimentGroup: "hyperparameters",
        configName: "high-exploration",
        population: 8,
        gaGenerations: 20,
        cmaGenerations: 21,
        gaMutation: 0.3,
        gaSelection: 0.5,
        cmaSigma: 0.4,
        gaSeeds: [gaSeed],
        cmaSeeds: [cmaSeed],
      }),
    ),
    configFromOptions(
      options,
      Object.assign({}, base, {
        experimentGroup: "hyperparameters",
        configName: "low-exploration",
        population: 8,
        gaGenerations: 20,
        cmaGenerations: 21,
        gaMutation: 0.1,
        gaSelection: 0.5,
        cmaSigma: 0.15,
        gaSeeds: [gaSeed],
        cmaSeeds: [cmaSeed],
      }),
    ),
    configFromOptions(
      options,
      Object.assign({}, base, {
        experimentGroup: "hyperparameters",
        configName: "stronger-ga-selection",
        population: 8,
        gaGenerations: 20,
        cmaGenerations: 21,
        gaMutation: 0.2,
        gaSelection: 0.35,
        cmaSigma: 0.25,
        gaSeeds: [gaSeed],
        cmaSeeds: [cmaSeed],
      }),
    ),
  ];
}

function csvValue(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value))
    return '"' + value.join("|").replace(/"/g, '""') + '"';
  if (typeof value === "object")
    return '"' + JSON.stringify(value).replace(/"/g, '""') + '"';
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function writeCsv(filePath, columns, rows) {
  const lines = [columns.map(csvValue).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvValue(row[column])).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  options.configurations = buildConfigurations(options);
  const outDir = path.resolve(options.out);
  fs.mkdirSync(outDir, { recursive: true });

  const context = {
    console,
    setTimeout,
    clearTimeout,
    performance: { now: () => Date.now() },
    __options: options,
  };
  vm.createContext(context);

  for (const file of ["boids.js", "ga_optimizer.js", "cma_optimizer.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, file), "utf8"),
      context,
      { filename: file },
    );
  }

  const result = await vm.runInContext(
    `
    (function() {
      const options = __options;
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

      function seedForRun(baseSeed, index) {
        return 1 + ((baseSeed + index * 1009 - 1) % 2147483646);
      }

      function evaluationSeeds(baseSeed, runs) {
        const seeds = [];
        let attempt = 0;
        while (seeds.length < runs && attempt < runs + RESERVED_OPTIMIZER_SEEDS.length + 1000) {
          const candidate = seedForRun(baseSeed, attempt);
          if (!RESERVED_OPTIMIZER_SEED_SET.has(candidate) && !seeds.includes(candidate)) {
            seeds.push(candidate);
          }
          attempt++;
        }
        return seeds;
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

      function metricValue(metric, key, fallback = 0) {
        const value = metric[key];
        return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

      function optimizerSeedProtocol(trainingCount) {
        const count = Math.max(1, Math.min(OPTIMIZER_SEED_SPLITS.training.length, Math.round(trainingCount)));
        return {
          training: OPTIMIZER_SEED_SPLITS.training.slice(0, count),
          validation: OPTIMIZER_SEED_SPLITS.validation.slice(),
          test: OPTIMIZER_SEED_SPLITS.test.slice()
        };
      }

      function optimizerCandidateSignature(weights, parameterKeys) {
        return parameterKeys.map((key) => {
          const value = weights && Object.prototype.hasOwnProperty.call(weights, key) ? weights[key] : "";
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
            label,
            weights: Object.assign({}, weights),
            fitness,
            cost,
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

      function evaluateWeightsOnSeeds(weights, parameterKeys, baseOptions, seeds) {
        const evaluator = new BoidsGAOptimizer({
          baseConf: Object.assign({}, baseOptions.baseConf || conf),
          variables: parameterKeys.slice(),
          numberOfVariables: parameterKeys.length,
          evaluationSeeds: seeds.slice(),
          targetChanges: baseOptions.targetChanges,
          robustnessPenalty: baseOptions.robustnessPenalty,
          maxSteps: baseOptions.maxSteps,
          autoRetargetOnMajority: baseOptions.autoRetargetOnMajority,
          yieldEverySteps: baseOptions.yieldEverySteps || 100
        });
        const genome = evaluator.weightsToGenome(weights);
        return evaluator.evaluateGenome(genome);
      }

      function attachSeedSplitMetrics(result, baseOptions, protocol, parameterKeys) {
        const candidates = optimizerValidationCandidates(result, parameterKeys);
        let selected = null;
        for (const candidate of candidates) {
          const validationResult = evaluateWeightsOnSeeds(candidate.weights, parameterKeys, baseOptions, protocol.validation);
          const validationSummary = splitMetricsSummary(validationResult);
          if (!selected || validationSummary.fitness > selected.validationSummary.fitness) {
            selected = { candidate, validationResult, validationSummary };
          }
        }
        if (selected) {
          result.weights = Object.assign({}, selected.candidate.weights);
          result.fitness = selected.candidate.fitness;
          result.cost = selected.candidate.cost;
          result.metrics = Object.assign({}, selected.candidate.metrics);
          result.validationSelection = {
            selected: selected.candidate.label,
            candidateCount: candidates.length,
            validationFitness: selected.validationSummary.fitness
          };
        }
        result.seedProtocol = {
          training: protocol.training.slice(),
          validation: protocol.validation.slice(),
          test: protocol.test.slice()
        };
        result.seedSplitMetrics = {
          training: splitMetricsSummary(result),
          validation: selected ? selected.validationSummary : splitMetricsSummary(result)
        };
        const testResult = evaluateWeightsOnSeeds(result.weights, parameterKeys, baseOptions, protocol.test);
        result.seedSplitMetrics.test = splitMetricsSummary(testResult);
        return result;
      }

      function runSceneForSummary(seed, steps, weights) {
        const sceneConf = Object.assign({}, conf, weights || {}, {
          seed,
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

      function runMetricsRecord(metric, source, optimizerRun, runIndex, seed, steps, config) {
        const targetInterval = metric.targetCompletionCount > 0 && metric.averageTargetChangeInterval > 0
          ? metric.averageTargetChangeInterval
          : steps;
        return {
          type: "repeated-run",
          experimentGroup: config.experimentGroup,
          configName: config.configName,
          method: source,
          source,
          optimizerRun,
          runIndex,
          seed,
          steps,
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

      function repeatedSummary(runRows, source, optimizerRun, seed, runs, steps, config) {
        const values = (key) => runRows.map((row) => row[key] || 0);
        return {
          type: "repeated-test",
          experimentGroup: config.experimentGroup,
          configName: config.configName,
          method: source,
          source,
          optimizerRun,
          seed,
          runs,
          steps,
          fitness: mean(values("fitness")),
          fitnessStd: standardDeviation(values("fitness")),
          targetsMean: mean(values("targets")),
          targetsStd: standardDeviation(values("targets")),
          targetTimeMean: mean(values("targetTime")),
          targetTimeStd: standardDeviation(values("targetTime")),
          orderMean: mean(values("order")),
          orderStd: standardDeviation(values("order")),
          nnMean: mean(values("nn")),
          nnStd: standardDeviation(values("nn")),
          spacingScore: mean(values("spacingScore")),
          cluster: mean(values("cluster")),
          collisionRate: mean(values("collisionRate"))
        };
      }

      function recordHistoryRows(result, method, optimizerRun, optimizerSeed, baseOptions, config) {
        const rows = [];
        for (const row of result.evaluationLog || []) {
          const weights = row.weights || {};
          rows.push({
            method,
            experimentGroup: config.experimentGroup,
            configName: config.configName,
            optimizerRun,
            optimizerSeed,
            generation: row.generation,
            individual: row.individual,
            rank: row.rank,
            populationSize: row.populationSize,
            evaluation: row.evaluation,
            trainingSeeds: baseOptions.evaluationSeeds.slice(),
            targetChanges: baseOptions.targetChanges,
            maxSteps: baseOptions.maxSteps,
            parameterKeys: (result.parameterKeys || baseOptions.variables || []).slice(),
            population: config.population,
            gaGenerations: config.gaGenerations,
            cmaGenerations: config.cmaGenerations,
            gaMutation: config.gaMutation,
            gaSelection: config.gaSelection,
            cmaSigma: config.cmaSigma,
            fitness: row.fitness,
            cost: row.cost,
            meanFitness: row.meanFitness,
            fitnessStd: row.fitnessStd,
            targetScore: row.targetScore,
            formationScore: row.formationScore,
            constraintScore: row.constraintScore,
            targets: row.targetCompletionCount,
            targetTime: row.averageTargetChangeInterval,
            order: row.orderParam,
            nn: row.meanNearestNeighborDistance,
            spacingScore: row.spacingScore,
            cluster: row.largestClusterFraction,
            collisionRate: row.collisionRate,
            sigma: row.sigma,
            cohesion: weights.cohesion,
            alignment: weights.alignment,
            separation: weights.separation,
            targetWeight: weights.targetWeight,
            avoidance: weights.avoidance,
            leaderFollowWeight: weights.leaderFollowWeight
          });
        }
        return rows;
      }

      function weightRow(result, method, optimizerRun, optimizerSeed, runtimeSeconds, config) {
        const split = result.seedSplitMetrics || {};
        const test = split.test || {};
        const weights = result.weights || {};
        return {
          run: optimizerRun,
          method,
          experimentGroup: config.experimentGroup,
          configName: config.configName,
          optimizerSeed,
          trainFitness: split.training && split.training.fitness,
          validationFitness: split.validation && split.validation.fitness,
          testFitness: test.fitness,
          fitnessStd: test.fitnessStd,
          targets: test.targetCompletionCount,
          averageTargetChangeInterval: test.averageTargetChangeInterval,
          order: test.orderParam,
          nn: test.meanNearestNeighborDistance,
          spacingScore: test.spacingScore,
          cluster: test.largestClusterFraction,
          collisions: test.collisionRate,
          runtimeSeconds,
          evaluations: result.evaluations,
          population: config.population,
          gaGenerations: config.gaGenerations,
          cmaGenerations: config.cmaGenerations,
          gaMutation: config.gaMutation,
          gaSelection: config.gaSelection,
          cmaSigma: config.cmaSigma,
          parameterKeys: result.parameterKeys || [],
          trainingSeeds: result.seedProtocol && result.seedProtocol.training,
          validationSeeds: result.seedProtocol && result.seedProtocol.validation,
          testSeeds: result.seedProtocol && result.seedProtocol.test,
          validationSelection: result.validationSelection,
          cohesion: weights.cohesion,
          alignment: weights.alignment,
          separation: weights.separation,
          targetWeight: weights.targetWeight,
          avoidance: weights.avoidance,
          leaderFollowWeight: weights.leaderFollowWeight
        };
      }

      const optimizerRows = [];
      const historyRows = [];
      const repeatedRows = [];
      let optimizerRun = 0;

      function runOne(method, seed, config) {
        optimizerRun++;
        const protocol = optimizerSeedProtocol(config.trainingSeeds);
        const parameterKeys = OPTIMIZER_VARIABLES.slice(0, config.variables);
        const baseConf = Object.assign({}, conf, {
          seed: config.testSeed,
          maxSteps: config.optSteps,
          targetVisibleBoids: 1,
          autoRetargetOnMajority: true
        });
        const commonOptions = {
          baseConf,
          variables: parameterKeys,
          numberOfVariables: parameterKeys.length,
          lowerLimit: 0,
          upperLimit: 1,
          bounds: { targetWeight: [0, 1] },
          maxSteps: config.optSteps,
          evaluationSeeds: protocol.training,
          targetChanges: config.targetChanges,
          robustnessPenalty: config.robustness,
          autoRetargetOnMajority: true,
          yieldEverySteps: 100
        };
        const start = Date.now();
        let result;
        let runOptions;
        if (method === "GA") {
          runOptions = Object.assign({}, commonOptions, {
            maximumIterations: config.gaGenerations,
            populationSize: config.population,
            mutationRate: config.gaMutation,
            selectionRate: config.gaSelection,
            seed
          });
          result = new BoidsGAOptimizer(runOptions).run();
        } else {
          runOptions = Object.assign({}, commonOptions, {
            maxGenerations: config.cmaGenerations,
            populationSize: config.population,
            sigma0: config.cmaSigma,
            seed
          });
          result = new BoidsCMAESOptimizer(runOptions).run();
        }
        if (options.skipSeedSplits) {
          result.seedProtocol = {
            training: protocol.training.slice(),
            validation: [],
            test: []
          };
          result.seedSplitMetrics = {
            training: splitMetricsSummary(result)
          };
        } else {
          attachSeedSplitMetrics(result, runOptions, protocol, parameterKeys);
        }
        const runtimeSeconds = (Date.now() - start) / 1000;
        optimizerRows.push(weightRow(result, method, optimizerRun, seed, runtimeSeconds, config));
        historyRows.push(...recordHistoryRows(result, method, optimizerRun, seed, runOptions, config));

        if (!options.skipRepeated) {
          const source = method + "-" + optimizerRun;
          const runRows = [];
          const repeatedSeeds = evaluationSeeds(config.testSeed, config.repeatedRuns);
          for (let i = 0; i < repeatedSeeds.length; i++) {
            const metrics = runSceneForSummary(repeatedSeeds[i], config.repeatedSteps, result.weights);
            runRows.push(runMetricsRecord(metrics, source, optimizerRun, i + 1, repeatedSeeds[i], config.repeatedSteps, config));
          }
          repeatedRows.push(repeatedSummary(runRows, source, optimizerRun, repeatedSeeds[0] || config.testSeed, repeatedSeeds.length, config.repeatedSteps, config));
          repeatedRows.push(...runRows);
        }
      }

      for (const config of options.configurations) {
        console.log("Configuration " + config.experimentGroup + "/" + config.configName + ".");
        for (const seed of config.gaSeeds) {
          console.log("Running GA seed " + seed + "...");
          runOne("GA", seed, config);
        }
        for (const seed of config.cmaSeeds) {
          console.log("Running CMA-ES seed " + seed + "...");
          runOne("CMA-ES", seed, config);
        }
      }

      return {
        options,
        optimizerSeedSplits: OPTIMIZER_SEED_SPLITS,
        optimizerRows,
        historyRows,
        repeatedRows
      };
    })()
  `,
    context,
  );

  writeCsv(
    path.join(outDir, "optimizer_weights.csv"),
    [
      "run",
      "method",
      "experimentGroup",
      "configName",
      "optimizerSeed",
      "trainFitness",
      "validationFitness",
      "testFitness",
      "fitnessStd",
      "targets",
      "averageTargetChangeInterval",
      "order",
      "nn",
      "spacingScore",
      "cluster",
      "collisions",
      "runtimeSeconds",
      "evaluations",
      "population",
      "gaGenerations",
      "cmaGenerations",
      "gaMutation",
      "gaSelection",
      "cmaSigma",
      "parameterKeys",
      "trainingSeeds",
      "validationSeeds",
      "testSeeds",
      "validationSelection",
      "cohesion",
      "alignment",
      "separation",
      "targetWeight",
      "avoidance",
      "leaderFollowWeight",
    ],
    result.optimizerRows,
  );
  writeCsv(
    path.join(outDir, "optimizer_history.csv"),
    [
      "method",
      "experimentGroup",
      "configName",
      "optimizerRun",
      "optimizerSeed",
      "generation",
      "individual",
      "rank",
      "populationSize",
      "evaluation",
      "trainingSeeds",
      "targetChanges",
      "maxSteps",
      "parameterKeys",
      "population",
      "gaGenerations",
      "cmaGenerations",
      "gaMutation",
      "gaSelection",
      "cmaSigma",
      "fitness",
      "cost",
      "meanFitness",
      "fitnessStd",
      "targetScore",
      "formationScore",
      "constraintScore",
      "targets",
      "targetTime",
      "order",
      "nn",
      "spacingScore",
      "cluster",
      "collisionRate",
      "sigma",
      "cohesion",
      "alignment",
      "separation",
      "targetWeight",
      "avoidance",
      "leaderFollowWeight",
    ],
    result.historyRows,
  );
  if (!options.skipRepeated) {
    writeCsv(
      path.join(outDir, "repeated_results.csv"),
      [
        "type",
        "experimentGroup",
        "configName",
        "method",
        "source",
        "optimizerRun",
        "runIndex",
        "seed",
        "runs",
        "steps",
        "fitness",
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
      ],
      result.repeatedRows,
    );
  }
  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    JSON.stringify(result, null, 2),
  );

  console.log("Done.");
  console.log("Output folder: " + outDir);
  console.log("Weights: " + path.join(outDir, "optimizer_weights.csv"));
  console.log("History: " + path.join(outDir, "optimizer_history.csv"));
  if (!options.skipRepeated) {
    console.log("Repeated tests: " + path.join(outDir, "repeated_results.csv"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
