// GA optimiser for the moving-vector coefficients described by Alaliyat et al.
// Our navigation model replaces leader following with target seeking.
const BOIDS_GA_PARAMETER_KEYS = [
  "cohesion",
  "alignment",
  "separation",
  "targetWeight",
  "avoidance",
  "randomWeight"
];

const BOIDS_GA_PARAMETER_BOUNDS = {
  cohesion: [0, 1],
  alignment: [0, 1],
  separation: [0, 1],
  targetWeight: [0, 1],
  avoidance: [0, 1],
  randomWeight: [0, 0.05]
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
    this.parameterKeys = options.parameterKeys || BOIDS_GA_PARAMETER_KEYS.slice();
    this.bounds = Object.assign({}, BOIDS_GA_PARAMETER_BOUNDS, options.bounds || {});
    this.populationSize = options.populationSize || 30;
    this.generations = options.generations || 40;
    this.eliteCount = options.eliteCount || 2;
    this.tournamentSize = options.tournamentSize || 3;
    this.crossoverRate = options.crossoverRate ?? 0.9;
    this.mutationRate = options.mutationRate ?? 0.18;
    this.mutationSigma = options.mutationSigma ?? 0.08;
    this.evaluationSeeds = options.evaluationSeeds || [12345, 23456, 34567];
    this.maxSteps = options.maxSteps || this.baseConf.maxSteps;
    this.yieldEverySteps = options.yieldEverySteps || 10;
    this.onProgress = options.onProgress || null;
    this.random = new GASeededRandom(options.seed || 24681357);
    this.history = [];
    this.evaluations = 0;
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
      maxSteps: this.maxSteps
    });
  }

  evaluateGenome(genome) {
    if (typeof Scene === "undefined") {
      throw new Error("BoidsGAOptimizer requires boids.js to be loaded first.");
    }

    const previousRngState = typeof rngState === "undefined" ? undefined : rngState;
    const perSeed = [];

    try {
      for (const seed of this.evaluationSeeds) {
        const scene = new Scene(this.candidateConf(genome, seed));

        for (let t = 0; t < this.maxSteps; t++) {
          scene.step();
        }

        perSeed.push(scene.computeOptimizationFitness());
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
    await new Promise((resolve) => {
      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        window.requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
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

    const previousRngState = typeof rngState === "undefined" ? undefined : rngState;
    const perSeed = [];

    try {
      for (let seedIndex = 0; seedIndex < this.evaluationSeeds.length; seedIndex++) {
        const seed = this.evaluationSeeds[seedIndex];
        const scene = new Scene(this.candidateConf(genome, seed));

        for (let step = 0; step < this.maxSteps; step++) {
          scene.step();

          if ((step + 1) % this.yieldEverySteps === 0) {
            this.reportProgress(Object.assign({}, progress, {
              phase: "evaluating",
              seed: seed,
              seedIndex: seedIndex + 1,
              seedCount: this.evaluationSeeds.length,
              step: step + 1,
              maxSteps: this.maxSteps
            }));
            await this.yieldControl();
          }
        }

        perSeed.push(scene.computeOptimizationFitness());
        await this.yieldControl();
      }
    } finally {
      if (typeof rngState !== "undefined" && previousRngState !== undefined) {
        rngState = previousRngState;
      }
    }

    this.evaluations++;
    return this.aggregateFitness(genome, perSeed);
  }

  aggregateFitness(genome, perSeed) {
    const keys = [
      "fitness",
      "orderParam",
      "timeScore",
      "targetSuccess",
      "crowdingPenalty",
      "collisionRate",
      "paramPenalty"
    ];

    const metrics = {};
    for (const key of keys) {
      metrics[key] = this.mean(perSeed.map((entry) => entry[key] || 0));
    }

    return {
      genome: genome.slice(),
      weights: this.genomeToWeights(genome),
      fitness: metrics.fitness,
      metrics: metrics,
      perSeed: perSeed
    };
  }

  mean(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  evaluatePopulation(population) {
    return population
      .map((genome) => this.evaluateGenome(genome))
      .sort((a, b) => b.fitness - a.fitness);
  }

  async evaluatePopulationAsync(population, generation) {
    const evaluated = [];

    for (let i = 0; i < population.length; i++) {
      const individual = await this.evaluateGenomeAsync(population[i], {
        generation: generation,
        individual: i + 1,
        populationSize: population.length
      });

      evaluated.push(individual);
      this.reportProgress({
        phase: "individual",
        generation: generation,
        individual: i + 1,
        populationSize: population.length,
        fitness: individual.fitness,
        bestFitness: Math.max(...evaluated.map((entry) => entry.fitness))
      });
      await this.yieldControl();
    }

    return evaluated.sort((a, b) => b.fitness - a.fitness);
  }

  selectParent(evaluatedPopulation) {
    let best = null;
    for (let i = 0; i < this.tournamentSize; i++) {
      const candidate = evaluatedPopulation[
        this.random.integer(0, evaluatedPopulation.length)
      ];
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
    const next = evaluatedPopulation
      .slice(0, this.eliteCount)
      .map((individual) => individual.genome.slice());

    while (next.length < this.populationSize) {
      const parentA = this.selectParent(evaluatedPopulation);
      const parentB = this.selectParent(evaluatedPopulation);
      const [childA, childB] = this.crossover(parentA, parentB);

      next.push(this.mutate(childA));
      if (next.length < this.populationSize) {
        next.push(this.mutate(childB));
      }
    }

    return next;
  }

  recordGeneration(generation, evaluatedPopulation) {
    const fitnessValues = evaluatedPopulation.map((individual) => individual.fitness);
    const best = evaluatedPopulation[0];

    this.history.push({
      generation: generation,
      bestFitness: best.fitness,
      meanFitness: this.mean(fitnessValues),
      bestWeights: Object.assign({}, best.weights),
      metrics: Object.assign({}, best.metrics),
      evaluations: this.evaluations
    });
  }

  run() {
    let population = this.initialPopulation();
    let evaluated = this.evaluatePopulation(population);
    this.recordGeneration(0, evaluated);

    for (let generation = 1; generation <= this.generations; generation++) {
      population = this.nextPopulation(evaluated);
      evaluated = this.evaluatePopulation(population);
      this.recordGeneration(generation, evaluated);
    }

    const best = evaluated[0];
    return {
      genome: best.genome.slice(),
      weights: Object.assign({}, best.weights),
      fitness: best.fitness,
      metrics: Object.assign({}, best.metrics),
      history: this.history.slice(),
      evaluations: this.evaluations,
      parameterKeys: this.parameterKeys.slice()
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
      bestWeights: Object.assign({}, evaluated[0].weights)
    });

    for (let generation = 1; generation <= this.generations; generation++) {
      population = this.nextPopulation(evaluated);
      evaluated = await this.evaluatePopulationAsync(population, generation);
      this.recordGeneration(generation, evaluated);
      this.reportProgress({
        phase: "generation",
        generation: generation,
        generations: this.generations,
        bestFitness: evaluated[0].fitness,
        bestWeights: Object.assign({}, evaluated[0].weights)
      });
      await this.yieldControl();
    }

    const best = evaluated[0];
    return {
      genome: best.genome.slice(),
      weights: Object.assign({}, best.weights),
      fitness: best.fitness,
      metrics: Object.assign({}, best.metrics),
      history: this.history.slice(),
      evaluations: this.evaluations,
      parameterKeys: this.parameterKeys.slice()
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
      `best fitness ${progress.bestFitness.toFixed(4)}`
    );
  }
}

function estimateBoidsGAWork(options = {}) {
  const populationSize = options.populationSize || 30;
  const generations = options.generations || 40;
  const seedCount = (options.evaluationSeeds || [12345, 23456, 34567]).length;
  const maxSteps = options.maxSteps || (typeof conf !== "undefined" ? conf.maxSteps : 1000);
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
  const weights = resultOrWeights && resultOrWeights.weights
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
      "Use: const result = await runAndApplyBoidsGAOptimizationAsync(options)"
    );
    return runAndApplyBoidsGAOptimizationAsync(options);
  }

  const result = runBoidsGAOptimization(options);
  applyBoidsGAResult(result, options.apply || {});
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
  applyBoidsGAResult(result, options.apply || {});
  return result;
}

if (typeof window !== "undefined") {
  window.BoidsGAOptimizer = BoidsGAOptimizer;
  window.runBoidsGAOptimization = runBoidsGAOptimization;
  window.runBoidsGAOptimizationAsync = runBoidsGAOptimizationAsync;
  window.applyBoidsGAResult = applyBoidsGAResult;
  window.runAndApplyBoidsGAOptimization = runAndApplyBoidsGAOptimization;
  window.runAndApplyBoidsGAOptimizationAsync = runAndApplyBoidsGAOptimizationAsync;
}
