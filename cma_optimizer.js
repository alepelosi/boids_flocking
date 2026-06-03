// CMA-ES optimizer for boids behavioral weight optimization.
// Reference: Hansen, N. "The CMA Evolution Strategy: A Tutorial" (arXiv:1604.00772v2)

"use strict";

const BOIDS_CMAES_PARAMETER_KEYS = [
  "cohesion",
  "alignment",
  "separation",
  "targetWeight",
  "avoidance",
  "leaderFollowWeight",
];

const BOIDS_CMAES_PARAMETER_BOUNDS = {
  cohesion: [0, 1],
  alignment: [0, 1],
  separation: [0, 1],
  targetWeight: [0, 1],
  avoidance: [0, 1],
  leaderFollowWeight: [0, 1],
  randomWeight: [0, 0.05],
};

const BOIDS_CMAES_DEFAULT_OPTIONS = {
  numberOfVariables: BOIDS_CMAES_PARAMETER_KEYS.length,
  lowerLimit: 0,
  upperLimit: 1,
  maxGenerations: 20,
  populationSize: 8,
  sigma0: 0.3,
  evaluationSeeds: [12345, 23456],
  targetChanges: 1,
  robustnessPenalty: 0.15,
  maxSteps: 200,
};

function _identity(n) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
}

function _matVec(M, v) {
  return M.map((row) => row.reduce((s, Mij, j) => s + Mij * v[j], 0));
}

function _vecDot(a, b) {
  return a.reduce((s, ai, i) => s + ai * b[i], 0);
}

function _vecNorm(v) {
  return Math.sqrt(_vecDot(v, v));
}

function _outerProd(a, b) {
  return a.map((ai) => b.map((bj) => ai * bj));
}

function _jacobiEigen(Cin, n) {
  let A = Cin.map((row) => row.slice());
  let V = _identity(n);

  for (let sweep = 0; sweep < 100; sweep++) {
    let offSq = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) offSq += A[i][j] * A[i][j];
    if (offSq < 1e-28) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p][q];
        if (Math.abs(apq) < 1e-15) continue;

        const theta = (A[q][q] - A[p][p]) / (2 * apq);
        const t =
          (theta >= 0 ? 1 : -1) /
          (Math.abs(theta) + Math.sqrt(1 + theta * theta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        const tau = s / (1 + c);

        A[p][p] -= t * apq;
        A[q][q] += t * apq;
        A[p][q] = 0;
        A[q][p] = 0;

        for (let r = 0; r < n; r++) {
          if (r !== p && r !== q) {
            const arp = A[r][p],
              arq = A[r][q];
            A[r][p] = arp - s * (arq + tau * arp);
            A[p][r] = A[r][p];
            A[r][q] = arq + s * (arp - tau * arq);
            A[q][r] = A[r][q];
          }
          const vrp = V[r][p],
            vrq = V[r][q];
          V[r][p] = vrp - s * (vrq + tau * vrp);
          V[r][q] = vrq + s * (vrp - tau * vrq);
        }
      }
    }
  }

  return {
    values: Array.from({ length: n }, (_, i) => A[i][i]),
    vectors: V,
  };
}

class CMAESRandom {
  constructor(seed = 13579246) {
    this.state = (seed | 1) >>> 0;
  }

  next() {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }

  normal() {
    let u, v, s;
    do {
      u = 2 * this.next() - 1;
      v = 2 * this.next() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    return u * Math.sqrt((-2 * Math.log(s)) / s);
  }

  normalVector(n) {
    return Array.from({ length: n }, () => this.normal());
  }
}

// BoidsCMAESOptimizer

class BoidsCMAESOptimizer {
  constructor(options = {}) {
    this.baseConf = Object.assign({}, options.baseConf || conf);

    const candidateKeys =
      options.parameterKeys ||
      (Array.isArray(options.variables)
        ? options.variables
        : BOIDS_CMAES_PARAMETER_KEYS.slice());
    const nVars =
      options.numberOfVariables ||
      options.numberOfOptimizationVariables ||
      (typeof options.variables === "number" ? options.variables : undefined) ||
      BOIDS_CMAES_DEFAULT_OPTIONS.numberOfVariables;
    this.parameterKeys = candidateKeys.slice(0, nVars);
    this.n = this.parameterKeys.length;
    if (this.n < 2) throw new Error("CMA-ES requires at least 2 parameters.");

    this.bounds = this._makeBounds(options);

    const n = this.n;

    this.lambda = Math.max(
      4,
      options.populationSize ||
        BOIDS_CMAES_DEFAULT_OPTIONS.populationSize ||
        4 + Math.floor(3 * Math.log(n)),
    );

    this.mu = Math.floor(this.lambda / 2);

    const wPrime = Array.from(
      { length: this.lambda },
      (_, i) => Math.log((this.lambda + 1) / 2) - Math.log(i + 1),
    );
    const sumWPos = wPrime.slice(0, this.mu).reduce((s, w) => s + w, 0);

    this.mueff =
      (sumWPos * sumWPos) /
      wPrime.slice(0, this.mu).reduce((s, w) => s + w * w, 0);

    const wPrimeNeg = wPrime.slice(this.mu); // all < 0
    const sumWNeg = wPrimeNeg.reduce((s, w) => s + w, 0); // < 0
    const sumWNegSq = wPrimeNeg.reduce((s, w) => s + w * w, 0);
    const sumWNegAbs = -sumWNeg; // Σ|w'_j|⁻  > 0
    const mueffMinus = sumWNegAbs > 0 ? (sumWNeg * sumWNeg) / sumWNegSq : 0;

    this.csigma = (this.mueff + 2) / (n + this.mueff + 5);
    this.dsigma =
      1 +
      2 * Math.max(0, Math.sqrt((this.mueff - 1) / (n + 1)) - 1) +
      this.csigma;

    this.cc = (4 + this.mueff / n) / (n + 4 + (2 * this.mueff) / n);
    this.c1 = 2 / (Math.pow(n + 1.3, 2) + this.mueff);
    this.cmu = Math.min(
      1 - this.c1,
      (2 * (this.mueff - 2 + 1 / this.mueff)) /
        (Math.pow(n + 2, 2) + (2 * this.mueff) / 2),
    );

    const alphaMuMinus = 1 + this.c1 / this.cmu;
    const alphaMueffMinus = 1 + (2 * mueffMinus) / (this.mueff + 2);
    const alphaPosdef = (1 - this.c1 - this.cmu) / (n * this.cmu);
    const alphaNeg = Math.min(alphaMuMinus, alphaMueffMinus, alphaPosdef);

    this.weights = wPrime.map((w, i) =>
      i < this.mu
        ? w / sumWPos
        : sumWNegAbs > 0
          ? (alphaNeg * w) / sumWNegAbs
          : 0,
    );

    this._sumAllWeights = this.weights.reduce((s, w) => s + w, 0);

    this.chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));

    // Run / Evaluation parameters
    this.sigma0 = options.sigma0 ?? BOIDS_CMAES_DEFAULT_OPTIONS.sigma0;
    this.maxGenerations =
      options.maxGenerations ||
      options.maximumIterations ||
      options.maximumIteration ||
      BOIDS_CMAES_DEFAULT_OPTIONS.maxGenerations;
    this.evaluationSeeds =
      options.evaluationSeeds ||
      BOIDS_CMAES_DEFAULT_OPTIONS.evaluationSeeds.slice();
    this.targetChanges = Math.max(
      0,
      Math.round(
        options.targetChanges ?? BOIDS_CMAES_DEFAULT_OPTIONS.targetChanges,
      ),
    );
    this.robustnessPenalty =
      options.robustnessPenalty ??
      BOIDS_CMAES_DEFAULT_OPTIONS.robustnessPenalty;
    this.maxSteps =
      options.maxSteps ||
      BOIDS_CMAES_DEFAULT_OPTIONS.maxSteps ||
      this.baseConf.maxSteps;
    this.autoRetargetOnMajority = options.autoRetargetOnMajority ?? false;
    this.yieldEverySteps = options.yieldEverySteps || 50;
    this.onProgress = options.onProgress || null;

    this.random = new CMAESRandom(options.seed || 99991357);
    this.history = [];
    this.evaluationLog = [];
    this.evaluations = 0;
  }

  // Bounds helpers

  _makeBounds(options) {
    const useGlobal =
      Object.prototype.hasOwnProperty.call(options, "lowerLimit") ||
      Object.prototype.hasOwnProperty.call(options, "upperLimit");
    const bounds = {};
    for (const key of this.parameterKeys) {
      const defaultBounds = (
        BOIDS_CMAES_PARAMETER_BOUNDS[key] || [0, 1]
      ).slice();
      if (useGlobal) {
        const requestedLo =
          options.lowerLimit ?? BOIDS_CMAES_DEFAULT_OPTIONS.lowerLimit;
        const requestedHi =
          options.upperLimit ?? BOIDS_CMAES_DEFAULT_OPTIONS.upperLimit;
        const lo = Math.max(defaultBounds[0], requestedLo);
        const hi = Math.min(defaultBounds[1], requestedHi);
        bounds[key] = hi > lo ? [lo, hi] : defaultBounds;
      } else {
        bounds[key] =
          options.bounds && options.bounds[key]
            ? options.bounds[key].slice()
            : defaultBounds;
      }
    }
    return bounds;
  }

  _normalize(key, value) {
    const [lo, hi] = this.bounds[key];
    if (hi <= lo) return 0;
    return (value - lo) / (hi - lo);
  }

  _denormalize(key, v01) {
    const [lo, hi] = this.bounds[key];
    return lo + Math.max(0, Math.min(1, v01)) * (hi - lo);
  }
  _toGenome(x) {
    return this.parameterKeys.map((key, i) => this._denormalize(key, x[i]));
  }

  // CMA-ES state management

  _initState() {
    const n = this.n;
    this.sigma = this.sigma0;
    this.mean = this.parameterKeys.map((key) =>
      this._normalize(key, this.baseConf[key] ?? 0.5),
    );
    // Covariance matrix C = I
    this.C = _identity(n);
    this.pc = new Array(n).fill(0);
    this.psigma = new Array(n).fill(0);
    this.B = _identity(n);
    this.D = new Array(n).fill(1);
    this.generation = 0;
  }

  _cinvHalfVec(v) {
    const Btv = this.B[0].map((_, j) =>
      this.B.reduce((s, row, i) => s + row[j] * v[i], 0),
    );
    // D^(-1) w
    const DinvBtv = Btv.map((val, j) => val / Math.max(1e-12, this.D[j]));
    // B (D^(-1) Bᵀ v)
    return _matVec(this.B, DinvBtv);
  }

  _samplePoint() {
    const z = this.random.normalVector(this.n);
    const Dz = z.map((zi, i) => this.D[i] * zi); // D z
    const y = _matVec(this.B, Dz); // y = B D z ~ N(0, C)
    const x = this.mean.map((m, i) => m + this.sigma * y[i]); // eq 40
    return { x, y, z };
  }

  _updateEigendecomposition() {
    const n = this.n;

    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        this.C[i][j] = this.C[j][i] = (this.C[i][j] + this.C[j][i]) / 2;

    const { values, vectors } = _jacobiEigen(this.C, n);

    this.D = values.map((v) => Math.sqrt(Math.max(1e-20, v)));
    this.B = vectors;
  }

  _updateDistribution(evaluated) {
    const n = this.n;
    const g = this.generation;

    const yw = new Array(n).fill(0);
    for (let i = 0; i < this.mu; i++)
      for (let d = 0; d < n; d++) yw[d] += this.weights[i] * evaluated[i].y[d];

    this.mean = this.mean.map((m, d) => m + this.sigma * yw[d]);

    const cinvHalf_yw = this._cinvHalfVec(yw);
    const csigFactor = Math.sqrt(this.csigma * (2 - this.csigma) * this.mueff);
    this.psigma = this.psigma.map(
      (p, d) => (1 - this.csigma) * p + csigFactor * cinvHalf_yw[d],
    );

    const pSigNorm = _vecNorm(this.psigma);
    this.sigma *= Math.exp(
      (this.csigma / this.dsigma) * (pSigNorm / this.chiN - 1),
    );

    const denom = Math.sqrt(1 - Math.pow(1 - this.csigma, 2 * (g + 1)));
    const hSigma =
      pSigNorm / Math.max(1e-20, denom) < (1.4 + 2 / (n + 1)) * this.chiN
        ? 1
        : 0;
    const deltaH = (1 - hSigma) * this.cc * (2 - this.cc);

    const ccFactor = hSigma * Math.sqrt(this.cc * (2 - this.cc) * this.mueff);
    this.pc = this.pc.map((p, d) => (1 - this.cc) * p + ccFactor * yw[d]);

    const decay =
      1 + this.c1 * deltaH - this.c1 - this.cmu * this._sumAllWeights;
    const pcOuter = _outerProd(this.pc, this.pc);
    const rankMu = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < this.lambda; i++) {
      const wi = this.weights[i];
      if (wi === 0) continue;
      const yi = evaluated[i].y;
      const wAdj =
        wi >= 0
          ? wi
          : (wi * n) / Math.max(1e-12, _vecDot(evaluated[i].z, evaluated[i].z));
      for (let r = 0; r < n; r++)
        for (let s = 0; s < n; s++) rankMu[r][s] += wAdj * yi[r] * yi[s];
    }

    for (let r = 0; r < n; r++)
      for (let s = 0; s < n; s++)
        this.C[r][s] =
          decay * this.C[r][s] +
          this.c1 * pcOuter[r][s] +
          this.cmu * rankMu[r][s];

    this._updateEigendecomposition();

    this.generation++;
  }

  // Evaluation of candidates

  _candidateConf(genome, seed) {
    const weights = {};
    for (let i = 0; i < this.n; i++) weights[this.parameterKeys[i]] = genome[i];
    return Object.assign({}, this.baseConf, weights, {
      seed,
      maxSteps: this.maxSteps,
      autoRetargetOnMajority: this.autoRetargetOnMajority,
    });
  }

  targetChangeSteps() {
    const steps = [];
    for (let i = 1; i <= this.targetChanges; i++) {
      const step = Math.floor((this.maxSteps * i) / (this.targetChanges + 1));
      if (step > 0 && step < this.maxSteps) steps.push(step);
    }
    return steps;
  }

  evaluateScene(scene, onStep = null) {
    const phaseMetrics = [];
    const targetChangeSteps = this.targetChangeSteps();
    let nextChangeIndex = 0;

    for (let step = 0; step < this.maxSteps; step++) {
      scene.step();

      if (typeof onStep === "function") onStep(step);

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

  // Synchronous evaluation
  evaluateGenome(genome) {
    if (typeof Scene === "undefined")
      throw new Error(
        "BoidsCMAESOptimizer requires boids.js to be loaded first.",
      );
    const prevRng = typeof rngState === "undefined" ? undefined : rngState;
    const perSeed = [];
    try {
      for (const seed of this.evaluationSeeds) {
        const scene = new Scene(this._candidateConf(genome, seed));
        perSeed.push(...this.evaluateScene(scene));
      }
    } finally {
      if (typeof rngState !== "undefined" && prevRng !== undefined)
        rngState = prevRng;
    }
    this.evaluations++;
    return this._aggregateFitness(genome, perSeed);
  }

  async _yieldControl() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  _reportProgress(progress) {
    if (typeof this.onProgress === "function") this.onProgress(progress);
  }

  // Asynchronous evaluation
  async evaluateGenomeAsync(genome, progress = {}) {
    if (typeof Scene === "undefined")
      throw new Error(
        "BoidsCMAESOptimizer requires boids.js to be loaded first.",
      );
    const prevRng = typeof rngState === "undefined" ? undefined : rngState;
    const perSeed = [];
    try {
      for (let si = 0; si < this.evaluationSeeds.length; si++) {
        const seed = this.evaluationSeeds[si];
        const scene = new Scene(this._candidateConf(genome, seed));
        perSeed.push(
          ...(await this.evaluateSceneAsync(
            scene,
            Object.assign({}, progress, {
              seed,
              seedIndex: si + 1,
              seedCount: this.evaluationSeeds.length,
            }),
          )),
        );
        await this._yieldControl();
      }
    } finally {
      if (typeof rngState !== "undefined" && prevRng !== undefined)
        rngState = prevRng;
    }
    this.evaluations++;
    return this._aggregateFitness(genome, perSeed);
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
        this._reportProgress(
          Object.assign({}, progress, {
            phase: "evaluating",
            step: step + 1,
            maxSteps: this.maxSteps,
          }),
        );
        await this._yieldControl();
      }
    }

    phaseMetrics.push(scene.computeOptimizationFitness());
    return phaseMetrics;
  }

  // Average fitness metrics across evaluation seeds
  _aggregateFitness(genome, perSeed) {
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
      const vals = perSeed.map((e) => e[key] || 0);
      metrics[key] = vals.reduce((s, v) => s + v, 0) / vals.length;
      metrics[key + "Std"] = this._standardDeviation(vals);
    }
    const fitnessValues = perSeed.map((e) => e.fitness || 0);
    const meanFitness = this._mean(fitnessValues);
    const fitnessStd = this._standardDeviation(fitnessValues);
    const robustFitness = Math.max(
      0,
      meanFitness - this.robustnessPenalty * fitnessStd,
    );

    metrics.meanFitness = meanFitness;
    metrics.fitnessStd = fitnessStd;
    metrics.fitness = robustFitness;

    const weights = {};
    for (let i = 0; i < this.n; i++) weights[this.parameterKeys[i]] = genome[i];
    return {
      genome: genome.slice(),
      weights,
      fitness: robustFitness,
      cost: Math.max(0, 1 - robustFitness),
      metrics,
      perSeed,
    };
  }

  _mean(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  _standardDeviation(values) {
    if (values.length <= 1) return 0;
    const avg = this._mean(values);
    const variance = this._mean(
      values.map((value) => Math.pow(value - avg, 2)),
    );
    return Math.sqrt(variance);
  }

  _logEvaluatedPopulation(generation, evaluated) {
    for (let i = 0; i < evaluated.length; i++) {
      const individual = evaluated[i];
      const metrics = individual.metrics || {};
      this.evaluationLog.push({
        method: "CMA-ES",
        generation: generation,
        individual: individual.individual || i + 1,
        rank: i + 1,
        populationSize: evaluated.length,
        evaluation: individual.evaluation || this.evaluations,
        fitness: individual.fitness,
        cost: individual.cost,
        meanFitness: metrics.meanFitness,
        fitnessStd: metrics.fitnessStd,
        targetScore: metrics.targetScore,
        formationScore: metrics.formationScore,
        constraintScore: metrics.constraintScore,
        targetCompletionCount: metrics.targetCompletionCount,
        averageTargetChangeInterval: metrics.averageTargetChangeInterval,
        orderParam: metrics.orderParam,
        meanNearestNeighborDistance: metrics.meanNearestNeighborDistance,
        spacingScore: metrics.spacingScore,
        largestClusterFraction: metrics.largestClusterFraction,
        collisionRate: metrics.collisionRate,
        sigma: this.sigma,
        weights: Object.assign({}, individual.weights),
        parameterKeys: this.parameterKeys.slice()
      });
    }
  }

  // Asynchronous run
  async runAsync() {
    this._initState();
    let bestResult = null;

    for (let gen = 0; gen < this.maxGenerations; gen++) {
      // Sample λ offspring  (eq 38–40)
      const samples = Array.from({ length: this.lambda }, () =>
        this._samplePoint(),
      );

      const evaluated = [];
      for (let k = 0; k < this.lambda; k++) {
        const genome = this._toGenome(samples[k].x);
        const result = await this.evaluateGenomeAsync(genome, {
          generation: gen,
          individual: k + 1,
          populationSize: this.lambda,
        });
        const entry = {
          x: samples[k].x,
          y: samples[k].y,
          z: samples[k].z,
          genome,
          fitness: result.fitness,
          cost: result.cost,
          weights: result.weights,
          metrics: result.metrics,
          individual: k + 1,
          evaluation: this.evaluations
        };
        evaluated.push(entry);

        this._reportProgress({
          phase: "individual",
          generation: gen,
          individual: k + 1,
          populationSize: this.lambda,
          fitness: result.fitness,
          cost: result.cost,
          bestFitness: bestResult ? bestResult.fitness : result.fitness,
        });
        await this._yieldControl();
      }

      // Sort by descending fitness (CMA-ES selects best μ individuals)
      evaluated.sort((a, b) => b.fitness - a.fitness);
      this._logEvaluatedPopulation(gen, evaluated);

      const best = evaluated[0];
      if (!bestResult || best.fitness > bestResult.fitness) {
        bestResult = {
          genome: best.genome.slice(),
          weights: Object.assign({}, best.weights),
          fitness: best.fitness,
          cost: best.cost,
          metrics: Object.assign({}, best.metrics),
        };
      }

      const meanFitness =
        evaluated.reduce((s, e) => s + e.fitness, 0) / evaluated.length;
      this.history.push({
        generation: gen,
        bestFitness: best.fitness,
        bestCost: best.cost,
        meanFitness,
        bestWeights: Object.assign({}, best.weights),
        metrics: Object.assign({}, best.metrics),
        sigma: this.sigma,
        evaluations: this.evaluations,
      });

      this._reportProgress({
        phase: "generation",
        generation: gen,
        generations: this.maxGenerations,
        bestFitness: best.fitness,
        bestCost: best.cost,
        bestWeights: Object.assign({}, best.weights),
        sigma: this.sigma,
      });

      if (this.sigma < 1e-10) break;

      this._updateDistribution(evaluated);
      await this._yieldControl();
    }

    return this._buildResult(bestResult);
  }

  // Synchronous run
  run() {
    this._initState();
    let bestResult = null;

    for (let gen = 0; gen < this.maxGenerations; gen++) {
      const samples = Array.from({ length: this.lambda }, () =>
        this._samplePoint(),
      );
      const evaluated = samples.map((s, index) => {
        const genome = this._toGenome(s.x);
        const result = this.evaluateGenome(genome);
        return {
          x: s.x,
          y: s.y,
          z: s.z,
          genome,
          fitness: result.fitness,
          cost: result.cost,
          weights: result.weights,
          metrics: result.metrics,
          individual: index + 1,
          evaluation: this.evaluations
        };
      });

      evaluated.sort((a, b) => b.fitness - a.fitness);
      this._logEvaluatedPopulation(gen, evaluated);

      const best = evaluated[0];
      if (!bestResult || best.fitness > bestResult.fitness) {
        bestResult = {
          genome: best.genome.slice(),
          weights: Object.assign({}, best.weights),
          fitness: best.fitness,
          cost: best.cost,
          metrics: Object.assign({}, best.metrics),
        };
      }

      const meanFitness =
        evaluated.reduce((s, e) => s + e.fitness, 0) / evaluated.length;
      this.history.push({
        generation: gen,
        bestFitness: best.fitness,
        bestCost: best.cost,
        meanFitness,
        bestWeights: Object.assign({}, best.weights),
        metrics: Object.assign({}, best.metrics),
        sigma: this.sigma,
        evaluations: this.evaluations,
      });

      if (this.sigma < 1e-10) break;
      this._updateDistribution(evaluated);
    }

    return this._buildResult(bestResult);
  }

  _buildResult(bestResult) {
    return {
      genome: bestResult.genome.slice(),
      weights: Object.assign({}, bestResult.weights),
      fitness: bestResult.fitness,
      cost: bestResult.cost,
      metrics: Object.assign({}, bestResult.metrics),
      history: this.history.slice(),
      evaluationLog: this.evaluationLog.slice(),
      evaluations: this.evaluations,
      scenarioCount:
        this.evaluationSeeds.length * (this.targetChangeSteps().length + 1),
      parameterKeys: this.parameterKeys.slice(),
      cmaParameters: this.getParameters(),
    };
  }

  getParameters() {
    return {
      n: this.n,
      lambda: this.lambda,
      mu: this.mu,
      mueff: this.mueff,
      sigma0: this.sigma0,
      csigma: this.csigma,
      dsigma: this.dsigma,
      cc: this.cc,
      c1: this.c1,
      cmu: this.cmu,
      chiN: this.chiN,
      parameterKeys: this.parameterKeys.slice(),
      evaluationSeeds: this.evaluationSeeds.slice(),
      targetChanges: this.targetChanges,
      robustnessPenalty: this.robustnessPenalty,
      maxSteps: this.maxSteps,
      maxGenerations: this.maxGenerations,
    };
  }
}

function runBoidsCMAESOptimization(options = {}) {
  const optimizer = new BoidsCMAESOptimizer(options);
  return optimizer.run();
}

function _defaultCMAESProgress(progress) {
  if (progress.phase === "generation") {
    console.log(
      `CMA-ES gen ${progress.generation}/${progress.generations}: ` +
        `fitness ${progress.bestFitness.toFixed(4)}, ` +
        `sigma ${progress.sigma.toFixed(6)}`,
    );
  }
}

async function runBoidsCMAESOptimizationAsync(options = {}) {
  const opts = Object.assign({}, options);
  if (!opts.onProgress) opts.onProgress = _defaultCMAESProgress;
  const optimizer = new BoidsCMAESOptimizer(opts);
  return await optimizer.runAsync();
}

// Same signature as applyBoidsGAResult in ga_optimizer.js
function applyBoidsCMAESResult(resultOrWeights, options = {}) {
  const weights =
    resultOrWeights && resultOrWeights.weights
      ? resultOrWeights.weights
      : resultOrWeights;
  if (!weights)
    throw new Error("Expected a CMA-ES result object or a weights object.");
  if (typeof applyWeightsToSimulation === "function")
    return applyWeightsToSimulation(weights, options);
  if (typeof conf === "undefined")
    throw new Error("No simulation configuration available.");
  return Object.assign(conf, weights);
}

async function runAndApplyBoidsCMAESOptimizationAsync(options = {}) {
  if (typeof running !== "undefined") {
    running = false;
    if (typeof setPlayPause === "function") setPlayPause();
  }
  const result = await runBoidsCMAESOptimizationAsync(options);
  applyBoidsCMAESResult(
    result,
    Object.assign({ reset: true, restart: true }, options.apply || {}),
  );
  return result;
}

if (typeof window !== "undefined") {
  window.BoidsCMAESOptimizer = BoidsCMAESOptimizer;
  window.runBoidsCMAESOptimization = runBoidsCMAESOptimization;
  window.runBoidsCMAESOptimizationAsync = runBoidsCMAESOptimizationAsync;
  window.applyBoidsCMAESResult = applyBoidsCMAESResult;
  window.runAndApplyBoidsCMAESOptimizationAsync =
    runAndApplyBoidsCMAESOptimizationAsync;
}
