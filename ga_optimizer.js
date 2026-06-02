// GA optimiser for the moving-vector coefficients described by Alaliyat et al.

const BOIDS_GA_PARAMETER_KEYS = [
  "cohesion",
  "alignment",
  "separation",
  "targetWeight",
  "avoidance",
  "leaderFollowWeight",
];

const BOIDS_GA_PARAMETER_BOUNDS = {
  cohesion: [0, 1],
  alignment: [0, 1],
  separation: [0, 1],
  targetWeight: [0, 1],
  avoidance: [0, 1],
  leaderFollowWeight: [0, 1],
  randomWeight: [0, 0.05],
};

const BOIDS_GA_DEFAULT_OPTIONS = {
  numberOfVariables: BOIDS_GA_PARAMETER_KEYS.length,
  lowerLimit: 0,
  upperLimit: 1,
  maximumIterations: 100,
  minimumCost: 0,
  populationSize: 20,
  mutationRate: 0.2,
  selectionRate: 0.5,
  evaluationSeeds: [12345, 23456, 34567],
  targetChanges: 1,
  robustnessPenalty: 0.15,
};

class GASeededRandom {
  constructor(seed = 98765) {
    this.state = seed & 0x7fffffff;
  }

  next() {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }

  range(min, max) {
    return min + this.next() * (max - min);
  }

  integer(min, maxExclusive) {
    return Math.floor(this.range(min, maxExclusive));
  }

  normal(mean = 0, std = 1) {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * std;
  }
}

class BoidsGAOptimizer {
  constructor(options = {}) {
    this.baseConf = Object.assign({}, options.baseConf || conf);
    const candidateKeys =
      options.parameterKeys ||
      (Array.isArray(options.variables)
        ? options.variables
        : BOIDS_GA_PARAMETER_KEYS.slice());
    const numberOfVariables =
      options.numberOfVariables ||
      options.numberOfOptimizationVariables ||
      (typeof options.variables === "number" ? options.variables : undefined) ||
      candidateKeys.length;
    this.parameterKeys = candidateKeys.slice(0, numberOfVariables);
    this.numberOfVariables = this.parameterKeys.length;
    this.lowerLimit = options.lowerLimit ?? BOIDS_GA_DEFAULT_OPTIONS.lowerLimit;
    this.upperLimit = options.upperLimit ?? BOIDS_GA_DEFAULT_OPTIONS.upperLimit;
    this.usesGlobalBounds =
      Object.prototype.hasOwnProperty.call(options, "lowerLimit") ||
      Object.prototype.hasOwnProperty.call(options, "upperLimit");
    this.bounds = this.makeBounds(options.bounds || {});
    this.populationSize =
      options.populationSize || BOIDS_GA_DEFAULT_OPTIONS.populationSize;
    this.generations =
      options.maximumIterations ||
      options.maximumIteration ||
      options.generations ||
      BOIDS_GA_DEFAULT_OPTIONS.maximumIterations;
    this.minimumCost =
      options.minimumCost ?? BOIDS_GA_DEFAULT_OPTIONS.minimumCost;
    this.eliteCount = options.eliteCount || 2;
    this.tournamentSize = options.tournamentSize || 3;
    this.crossoverRate = options.crossoverRate ?? 0.9;
    this.mutationRate =
      options.mutationRate ?? BOIDS_GA_DEFAULT_OPTIONS.mutationRate;
    this.mutationSigma = options.mutationSigma ?? 0.08;
    this.selectionRate =
      options.selectionRate ?? BOIDS_GA_DEFAULT_OPTIONS.selectionRate;
    this.evaluationSeeds =
      options.evaluationSeeds ||
      BOIDS_GA_DEFAULT_OPTIONS.evaluationSeeds.slice();
    this.targetChanges = Math.max(
      0,
      Math.round(
        options.targetChanges ?? BOIDS_GA_DEFAULT_OPTIONS.targetChanges,
      ),
    );
    this.robustnessPenalty =
      options.robustnessPenalty ?? BOIDS_GA_DEFAULT_OPTIONS.robustnessPenalty;
    this.maxSteps = options.maxSteps || this.baseConf.maxSteps;
    this.autoRetargetOnMajority = options.autoRetargetOnMajority ?? false;
    this.yieldEverySteps = options.yieldEverySteps || 10;
    this.onProgress = options.onProgress || null;
    this.random = new GASeededRandom(options.seed || 24681357);
    this.history = [];
    this.evaluations = 0;
  }

  makeBounds(overrides = {}) {
    const bounds = {};

    for (const key of BOIDS_GA_PARAMETER_KEYS) {
      const defaultBounds = (BOIDS_GA_PARAMETER_BOUNDS[key] || [0, 1]).slice();
      if (this.usesGlobalBounds && this.parameterKeys.includes(key)) {
        const lo = Math.max(defaultBounds[0], this.lowerLimit);
        const hi = Math.min(defaultBounds[1], this.upperLimit);
        bounds[key] = hi > lo ? [lo, hi] : defaultBounds;
      } else {
        bounds[key] = defaultBounds;
      }
    }

    return Object.assign(bounds, overrides);
  }

  getGAParameters() {
    return {
      numberOfVariables: this.numberOfVariables,
      variables: this.parameterKeys.slice(),
      lowerLimit: this.lowerLimit,
      upperLimit: this.upperLimit,
      maximumIterations: this.generations,
      minimumCost: this.minimumCost,
      populationSize: this.populationSize,
      mutationRate: this.mutationRate,
      selectionRate: this.selectionRate,
      evaluationSeeds: this.evaluationSeeds.slice(),
      targetChanges: this.targetChanges,
      robustnessPenalty: this.robustnessPenalty,
      bounds: Object.fromEntries(
        this.parameterKeys.map((key) => [key, this.bounds[key].slice()]),
      ),
    };
  }

  genomeToWeights(genome) {
    const weights = {};
    for (let i = 0; i < this.parameterKeys.length; i++) {
      weights[this.parameterKeys[i]] = genome[i];
    }
    return weights;
  }

  weightsToGenome(weights) {
    return this.parameterKeys.map((key) => {
      const fallback = this.baseConf[key];
      const value = Object.prototype.hasOwnProperty.call(weights, key)
        ? weights[key]
        : fallback;
      return this.clampToBounds(key, value);
    });
  }

  randomGenome() {
    return this.parameterKeys.map((key) => {
      const [min, max] = this.bounds[key];
      return this.random.range(min, max);
    });
  }

  initialPopulation() {
    const population = [];
    population.push(this.weightsToGenome(this.baseConf));

    while (population.length < this.populationSize) {
      population.push(this.randomGenome());
    }

    return population;
  }

  clampToBounds(key, value) {
    const [min, max] = this.bounds[key];
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  candidateConf(genome, seed) {
    return Object.assign({}, this.baseConf, this.genomeToWeights(genome), {
      seed: seed,
      maxSteps: this.maxSteps,
      autoRetargetOnMajority: this.autoRetargetOnMajority,
    });
  }

  targetChangeSteps() {
    const steps = [];
    for (let i = 1; i <= this.targetChanges; i++) {
      const step = Math.floor((this.maxSteps * i) / (this.targetChanges + 1));
      if (step > 0 && step < this.maxSteps) {
        steps.push(step);
      }
    }
    return steps;
  }

  evaluateScene(scene, onStep = null) {
    const phaseMetrics = [];
    const targetChangeSteps = this.targetChangeSteps();
    let nextChangeIndex = 0;

    for (let step = 0; step < this.maxSteps; step++) {
      scene.step();

      if (typeof onStep === "function") {
        onStep(step);
      }

      if (
        nextChangeIndex < targetChangeSteps.length &&
        step + 1 === targetChangeSteps[nextChangeIndex]
      ) {
        phaseMetrics.push(scene.computeOptimizationFitness());
        scene.generateNewTarget();
        nextChangeIndex++;
      }
    }

    phaseMetrics.push(scene.computeOptimizationFitness());
    return phaseMetrics;
  }

  evaluateGenome(genome) {
    if (typeof Scene === "undefined") {
      throw new Error("BoidsGAOptimizer requires boids.js to be loaded first.");
    }

    const previousRngState =
      typeof rngState === "undefined" ? undefined : rngState;
    const perSeed = [];

    try {
      for (const seed of this.evaluationSeeds) {
        const scene = new Scene(this.candidateConf(genome, seed));
        perSeed.push(...this.evaluateScene(scene));
      }
    } finally {
      if (typeof rngState !== "undefined" && previousRngState !== undefined) {
        rngState = previousRngState;
      }
    }

    this.evaluations++;
    return this.aggregateFitness(genome, perSeed);
  }

  async yieldControl() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  reportProgress(progress) {
    if (typeof this.onProgress === "function") {
      this.onProgress(progress);
    }
  }

  async evaluateGenomeAsync(genome, progress = {}) {
    if (typeof Scene === "undefined") {
      throw new Error("BoidsGAOptimizer requires boids.js to be loaded first.");
    }

    const previousRngState =
      typeof rngState === "undefined" ? undefined : rngState;
    const perSeed = [];

    try {
      for (
        let seedIndex = 0;
        seedIndex < this.evaluationSeeds.length;
        seedIndex++
      ) {
        const seed = this.evaluationSeeds[seedIndex];
        const scene = new Scene(this.candidateConf(genome, seed));

        perSeed.push(
          ...(await this.evaluateSceneAsync(
            scene,
            Object.assign({}, progress, {
              seed: seed,
              seedIndex: seedIndex + 1,
              seedCount: this.evaluationSeeds.length,
            }),
          )),
        );
      }
    } finally {
      if (typeof rngState !== "undefined" && previousRngState !== undefined) {
        rngState = previousRngState;
      }
    }

    this.evaluations++;
    return this.aggregateFitness(genome, perSeed);
  }

  async evaluateSceneAsync(scene, progress = {}) {
    const phaseMetrics = [];
    const targetChangeSteps = this.targetChangeSteps();
    let nextChangeIndex = 0;

    for (let step = 0; step < this.maxSteps; step++) {
      scene.step();

      if (
        nextChangeIndex < targetChangeSteps.length &&
        step + 1 === targetChangeSteps[nextChangeIndex]
      ) {
        phaseMetrics.push(scene.computeOptimizationFitness());
        scene.generateNewTarget();
        nextChangeIndex++;
      }

      if (
        (step + 1) % this.yieldEverySteps === 0 ||
        step + 1 === this.maxSteps
      ) {
        this.reportProgress(
          Object.assign({}, progress, {
            phase: "evaluating",
            step: step + 1,
            maxSteps: this.maxSteps,
          }),
        );
        await this.yieldControl();
      }
    }

    phaseMetrics.push(scene.computeOptimizationFitness());
    return phaseMetrics;
  }

  aggregateFitness(genome, perSeed) {
    const keys = [
      "orderParam",
      "timeScore",
      "targetArrivalSuccess",
      "leaderTargetArrivalSuccess",
      "leaderTargetApproachScore",
      "leaderFollowScore",
      "bestTargetArrivalSuccess",
      "bestLeaderTargetApproachScore",
      "averageTargetArrivalSuccess",
      "averageLeaderTargetApproachScore",
      "averageLeaderTargetArrivalSuccess",
      "averageLeaderFollowScore",
      "targetApproachScore",
      "bestTargetApproachScore",
      "averageTargetApproachScore",
      "leaderNavigationScore",
      "flockNavigationScore",
      "taskCompletionScore",
      "targetCompletionScore",
      "targetIntervalScore",
      "targetScore",
      "formationScore",
      "spacingScore",
      "constraintScore",
      "navigationCost",
      "alignmentCost",
      "collisionCost",
      "collisionPenalty",
      "crowdingCost",
      "fragmentationCost",
      "crowdingPenalty",
      "collisionRate",
      "meanNearestNeighborDistance",
      "medianNearestNeighborDistance",
      "minNearestNeighborDistance",
      "flockComponents",
      "largestClusterFraction",
      "fragmentationPenalty",
      "meanSpeed",
      "speedStd",
      "minObstacleClearance",
      "meanObstacleClearance",
      "obstacleContactFraction",
      "targetCompletionCount",
      "lastTargetChangeInterval",
      "averageTargetChangeInterval",
      "targetChangeIntervalStd",
    ];

    const metrics = {};
    for (const key of keys) {
      const values = perSeed.map((entry) => entry[key] || 0);
      metrics[key] = this.mean(values);
      metrics[key + "Std"] = this.standardDeviation(values);
    }

    const fitnessValues = perSeed.map((entry) => entry.fitness || 0);
    const meanFitness = this.mean(fitnessValues);
    const fitnessStd = this.standardDeviation(fitnessValues);
    const robustFitness = Math.max(
      0,
      meanFitness - this.robustnessPenalty * fitnessStd,
    );

    metrics.meanFitness = meanFitness;
    metrics.fitnessStd = fitnessStd;
    metrics.fitness = robustFitness;

    return {
      genome: genome.slice(),
      weights: this.genomeToWeights(genome),
      fitness: robustFitness,
      cost: this.fitnessToCost(robustFitness),
      metrics: metrics,
      perSeed: perSeed,
    };
  }

  fitnessToCost(fitness) {
    return Math.max(0, 1 - fitness);
  }

  mean(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  standardDeviation(values) {
    if (values.length <= 1) return 0;
    const avg = this.mean(values);
    const variance = this.mean(values.map((value) => Math.pow(value - avg, 2)));
    return Math.sqrt(variance);
  }

  evaluatePopulation(population) {
    return population
      .map((genome) => this.evaluateGenome(genome))
      .sort((a, b) => b.fitness - a.fitness);
  }

  parentPool(evaluatedPopulation) {
    const count = Math.max(
      2,
      Math.ceil(this.selectionRate * evaluatedPopulation.length),
    );
    return evaluatedPopulation.slice(0, count);
  }

  async evaluatePopulationAsync(population, generation) {
    const evaluated = [];

    for (let i = 0; i < population.length; i++) {
      const individual = await this.evaluateGenomeAsync(population[i], {
        generation: generation,
        individual: i + 1,
        populationSize: population.length,
      });

      evaluated.push(individual);
      this.reportProgress({
        phase: "individual",
        generation: generation,
        individual: i + 1,
        populationSize: population.length,
        fitness: individual.fitness,
        cost: individual.cost,
        bestFitness: Math.max(...evaluated.map((entry) => entry.fitness)),
      });
      await this.yieldControl();
    }

    return evaluated.sort((a, b) => b.fitness - a.fitness);
  }

  selectParent(evaluatedPopulation) {
    let best = null;
    for (let i = 0; i < this.tournamentSize; i++) {
      const candidate =
        evaluatedPopulation[this.random.integer(0, evaluatedPopulation.length)];
      if (!best || candidate.fitness > best.fitness) {
        best = candidate;
      }
    }
    return best.genome;
  }

  crossover(parentA, parentB) {
    if (this.random.next() > this.crossoverRate) {
      return [parentA.slice(), parentB.slice()];
    }

    const childA = [];
    const childB = [];

    for (let i = 0; i < parentA.length; i++) {
      const alpha = this.random.next();
      childA.push(alpha * parentA[i] + (1 - alpha) * parentB[i]);
      childB.push(alpha * parentB[i] + (1 - alpha) * parentA[i]);
    }

    return [childA, childB];
  }

  mutate(genome) {
    return genome.map((gene, index) => {
      const key = this.parameterKeys[index];
      const [min, max] = this.bounds[key];

      if (this.random.next() > this.mutationRate) {
        return this.clampToBounds(key, gene);
      }

      const sigma = this.mutationSigma * (max - min);
      return this.clampToBounds(key, gene + this.random.normal(0, sigma));
    });
  }

  nextPopulation(evaluatedPopulation) {
    const parentPool = this.parentPool(evaluatedPopulation);
    const next = evaluatedPopulation
      .slice(0, this.eliteCount)
      .map((individual) => individual.genome.slice());

    while (next.length < this.populationSize) {
      const parentA = this.selectParent(parentPool);
      const parentB = this.selectParent(parentPool);
      const [childA, childB] = this.crossover(parentA, parentB);

      next.push(this.mutate(childA));
      if (next.length < this.populationSize) {
        next.push(this.mutate(childB));
      }
    }

    return next;
  }

  recordGeneration(generation, evaluatedPopulation) {
    const fitnessValues = evaluatedPopulation.map(
      (individual) => individual.fitness,
    );
    const best = evaluatedPopulation[0];

    this.history.push({
      generation: generation,
      bestFitness: best.fitness,
      bestCost: best.cost,
      meanFitness: this.mean(fitnessValues),
      bestWeights: Object.assign({}, best.weights),
      metrics: Object.assign({}, best.metrics),
      evaluations: this.evaluations,
    });
  }

  run() {
    let population = this.initialPopulation();
    let evaluated = this.evaluatePopulation(population);
    this.recordGeneration(0, evaluated);

    for (let generation = 1; generation <= this.generations; generation++) {
      if (evaluated[0].cost <= this.minimumCost) {
        break;
      }

      population = this.nextPopulation(evaluated);
      evaluated = this.evaluatePopulation(population);
      this.recordGeneration(generation, evaluated);
    }

    const best = evaluated[0];
    return {
      genome: best.genome.slice(),
      weights: Object.assign({}, best.weights),
      fitness: best.fitness,
      cost: best.cost,
      metrics: Object.assign({}, best.metrics),
      history: this.history.slice(),
      evaluations: this.evaluations,
      scenarioCount:
        this.evaluationSeeds.length * (this.targetChangeSteps().length + 1),
      parameterKeys: this.parameterKeys.slice(),
      gaParameters: this.getGAParameters(),
    };
  }

  async runAsync() {
    let population = this.initialPopulation();
    let evaluated = await this.evaluatePopulationAsync(population, 0);
    this.recordGeneration(0, evaluated);
    this.reportProgress({
      phase: "generation",
      generation: 0,
      generations: this.generations,
      bestFitness: evaluated[0].fitness,
      bestCost: evaluated[0].cost,
      bestWeights: Object.assign({}, evaluated[0].weights),
    });

    for (let generation = 1; generation <= this.generations; generation++) {
      if (evaluated[0].cost <= this.minimumCost) {
        break;
      }

      population = this.nextPopulation(evaluated);
      evaluated = await this.evaluatePopulationAsync(population, generation);
      this.recordGeneration(generation, evaluated);
      this.reportProgress({
        phase: "generation",
        generation: generation,
        generations: this.generations,
        bestFitness: evaluated[0].fitness,
        bestCost: evaluated[0].cost,
        bestWeights: Object.assign({}, evaluated[0].weights),
      });
      await this.yieldControl();
    }

    const best = evaluated[0];
    return {
      genome: best.genome.slice(),
      weights: Object.assign({}, best.weights),
      fitness: best.fitness,
      cost: best.cost,
      metrics: Object.assign({}, best.metrics),
      history: this.history.slice(),
      evaluations: this.evaluations,
      scenarioCount:
        this.evaluationSeeds.length * (this.targetChangeSteps().length + 1),
      parameterKeys: this.parameterKeys.slice(),
      gaParameters: this.getGAParameters(),
    };
  }

  applyWeights(weights, targetConf = conf) {
    for (const key of this.parameterKeys) {
      if (Object.prototype.hasOwnProperty.call(weights, key)) {
        targetConf[key] = this.clampToBounds(key, weights[key]);
      }
    }
    return targetConf;
  }
}

function runBoidsGAOptimization(options = {}) {
  const optimizer = new BoidsGAOptimizer(options);
  return optimizer.run();
}

function defaultBoidsGAProgress(progress) {
  if (progress.phase === "generation") {
    console.log(
      `GA generation ${progress.generation}/${progress.generations}: ` +
        `best fitness ${progress.bestFitness.toFixed(4)}, ` +
        `cost ${progress.bestCost.toFixed(4)}`,
    );
  }
}

function estimateBoidsGAWork(options = {}) {
  const populationSize =
    options.populationSize || BOIDS_GA_DEFAULT_OPTIONS.populationSize;
  const generations =
    options.maximumIterations ||
    options.maximumIteration ||
    options.generations ||
    BOIDS_GA_DEFAULT_OPTIONS.maximumIterations;
  const seedCount = (
    options.evaluationSeeds || BOIDS_GA_DEFAULT_OPTIONS.evaluationSeeds
  ).length;
  const maxSteps =
    options.maxSteps || (typeof conf !== "undefined" ? conf.maxSteps : 1000);
  return populationSize * (generations + 1) * seedCount * maxSteps;
}

async function runBoidsGAOptimizationAsync(options = {}) {
  const runOptions = Object.assign({}, options);
  if (!runOptions.onProgress) {
    runOptions.onProgress = defaultBoidsGAProgress;
  }
  const optimizer = new BoidsGAOptimizer(runOptions);
  return await optimizer.runAsync();
}

function applyBoidsGAResult(resultOrWeights, options = {}) {
  const weights =
    resultOrWeights && resultOrWeights.weights
      ? resultOrWeights.weights
      : resultOrWeights;

  if (!weights) {
    throw new Error("Expected a GA result object or a weights object.");
  }

  if (typeof applyWeightsToSimulation === "function") {
    return applyWeightsToSimulation(weights, options);
  }

  if (typeof conf === "undefined") {
    throw new Error("No simulation configuration is available.");
  }

  return Object.assign(conf, weights);
}

function runAndApplyBoidsGAOptimization(options = {}) {
  if (typeof window !== "undefined" && estimateBoidsGAWork(options) > 20000) {
    console.warn(
      "This GA run is large, so it is running asynchronously. " +
        "Use: const result = await runAndApplyBoidsGAOptimizationAsync(options)",
    );
    return runAndApplyBoidsGAOptimizationAsync(options);
  }

  const result = runBoidsGAOptimization(options);
  applyBoidsGAResult(
    result,
    Object.assign({ reset: true, restart: true }, options.apply || {}),
  );
  return result;
}

async function runAndApplyBoidsGAOptimizationAsync(options = {}) {
  if (typeof running !== "undefined") {
    running = false;
    if (typeof setPlayPause === "function") {
      setPlayPause();
    }
  }

  const result = await runBoidsGAOptimizationAsync(options);
  applyBoidsGAResult(
    result,
    Object.assign({ reset: true, restart: true }, options.apply || {}),
  );
  return result;
}

if (typeof window !== "undefined") {
  window.BOIDS_GA_DEFAULT_OPTIONS = BOIDS_GA_DEFAULT_OPTIONS;
  window.BoidsGAOptimizer = BoidsGAOptimizer;
  window.runBoidsGAOptimization = runBoidsGAOptimization;
  window.runBoidsGAOptimizationAsync = runBoidsGAOptimizationAsync;
  window.applyBoidsGAResult = applyBoidsGAResult;
  window.runAndApplyBoidsGAOptimization = runAndApplyBoidsGAOptimization;
  window.runAndApplyBoidsGAOptimizationAsync =
    runAndApplyBoidsGAOptimizationAsync;
}
