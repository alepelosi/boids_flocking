const MIN_SPEED = 0.5;
const MAX_SPEED = 3.0;
const MAX_ACCELERATION = 0.12;
const MAX_OBSTACLE_ACCELERATION = 0.55;

let canvas, S;
let conf = {
  w: 800,
  h: 800,
  N: 100,
  zoom: 1,
  boidRadius: 5,
  separationRadius: 24,
  interactionRadius: 70,
  obstaclePerceptionRadius: 90,
  cohesion: 0.55,
  separation: 0.75,
  alignment: 0.75,
  avoidance: 1.0,
  targetX: 700,
  targetY: 700,
  targetWeight: 0.22,
  targetRadius: 60,
  numObstacles: 8,
  obstacleRadius: 40,
  seed: 12345,
  maxSteps: 1000,
  majorityThreshold: 0.8,
  failurePenalty: 2,
  fovAngle: 135,
  avoidanceMargin: 10,
  forwardOffset: 20,
  randomWeight: 0.015,
  showInteractionRadius: false
};

let rngState = conf.seed;

function seededRandom() {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

class Canvas {
  constructor(Scene, conf) {
    this.zoom = conf.zoom;
    this.S = Scene;
    this.height = this.S.h;
    this.width = this.S.w;
    this.el = document.createElement("canvas");
    this.el.width = this.width * this.zoom;
    this.el.height = this.height * this.zoom;
    let parent_element = document.getElementById("canvasModel");
    parent_element.appendChild(this.el);

    this.ctx = this.el.getContext("2d");
    this.ctx.lineWidth = 0.2;
    this.ctx.lineCap = "butt";
  }

  drawTarget() {
    this.ctx.strokeStyle = "#008000";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(
      this.S.conf.targetX,
      this.S.conf.targetY,
      this.S.conf.targetRadius,
      0,
      2 * Math.PI
    );
    this.ctx.stroke();
  }

  drawObstacles() {
    this.ctx.fillStyle = "#666666";
    for (let obs of this.S.obstacles) {
      this.ctx.beginPath();
      this.ctx.arc(obs.x, obs.y, obs.radius, 0, 2 * Math.PI);
      this.ctx.fill();
      this.ctx.strokeStyle = "#444444";
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }
  }

  background(col) {
    col = col || "000000";
    this.ctx.fillStyle = "#" + col;
    this.ctx.fillRect(0, 0, this.el.width, this.el.height);
  }

  fillCircle(pos, col, radius) {
    this.ctx.fillStyle = "#" + col;
    this.ctx.beginPath();
    this.ctx.arc(pos[0], pos[1], radius, 0, 2 * Math.PI);
    this.ctx.stroke();
    this.ctx.fill();
  }

  drawCircle(pos, col, radius) {
    this.ctx.lineWidth = 0.5 * this.zoom;
    this.ctx.strokeStyle = "#" + col;
    this.ctx.beginPath();
    this.ctx.arc(pos[0], pos[1], radius * this.zoom, 0, 2 * Math.PI);
    this.ctx.stroke();
  }

  drawDirections() {
    this.ctx.strokeStyle = "#000000";
    const ctx = this.ctx,
      zoom = this.zoom;
    ctx.beginPath();
    ctx.lineWidth = 2 * zoom;

    for (let p of this.S.swarm) {
      const startPoint = p.multiplyVector(p.pos, zoom);

      let drawVec = p.multiplyVector(p.dir, this.S.conf.boidRadius * 2.2 * zoom);
      drawVec = p.addVectors(startPoint, drawVec);

      ctx.moveTo(startPoint[0], startPoint[1]);
      ctx.lineTo(drawVec[0], drawVec[1]);
    }
    ctx.stroke();
  }

  drawSwarm() {
    this.background("eaecef");
    this.drawObstacles();
    this.drawTarget();
    for (let p of this.S.swarm) {
      if (this.S.conf.showInteractionRadius) {
        this.drawCircle(p.pos, "aaaaaa", this.S.conf.interactionRadius);
      }
      this.fillCircle(p.pos, "ff0000", this.S.conf.boidRadius);
    }
    this.drawDirections();
  }
}

class Scene {
  constructor(conf) {
    this.w = conf.w;
    this.h = conf.h;
    this.conf = conf;
    this.defaultTarget = [conf.targetX, conf.targetY];
    this.swarm = [];
    this.obstacles = [];
    this.collisionCount = 0;
    this.firstMajorityTime = -1;
    rngState = conf.seed;
    this.generateObstacles();
    this.generateTarget();
    this.makeSwarm();
    this.time = 0;
  }

  random() {
    return seededRandom();
  }

  randomRange(min, max) {
    return min + this.random() * (max - min);
  }

  generateObstacles() {
    const margin = this.conf.obstacleRadius + 20;
    this.obstacles = [];

    for (let i = 0; i < this.conf.numObstacles; i++) {
      let attempts = 0;
      let valid = false;
      let ox, oy;

      while (!valid && attempts < 100) {
        ox = this.randomRange(margin, this.w - margin);
        oy = this.randomRange(margin, this.h - margin);

        const distToOrigin = Math.sqrt(ox * ox + oy * oy);

        if (distToOrigin > margin) {
          valid = true;
          for (let obs of this.obstacles) {
            const dist = Math.sqrt(Math.pow(ox - obs.x, 2) + Math.pow(oy - obs.y, 2));
            if (dist < this.conf.obstacleRadius * 2 + 20) {
              valid = false;
              break;
            }
          }
        }
        attempts++;
      }

      if (valid) {
        this.obstacles.push({ x: ox, y: oy, radius: this.conf.obstacleRadius });
      }
    }
  }

  targetOverlapsObstacle(tx, ty) {
    for (let obs of this.obstacles) {
      const dist = Math.sqrt(Math.pow(tx - obs.x, 2) + Math.pow(ty - obs.y, 2));
      if (dist < obs.radius + this.conf.targetRadius + 20) {
        return true;
      }
    }
    return false;
  }

  setTarget(tx, ty) {
    this.conf.targetX = Math.max(0, Math.min(this.w, tx));
    this.conf.targetY = Math.max(0, Math.min(this.h, ty));
  }

  generateTarget(previousTarget = undefined) {
    const margin = this.conf.targetRadius + 30;

    for (let attempts = 0; attempts < 100; attempts++) {
      const tx = this.randomRange(margin, this.w - margin);
      const ty = this.randomRange(margin, this.h - margin);

      if (!this.targetOverlapsObstacle(tx, ty)) {
        if (
          previousTarget &&
          this.euclideanDist([tx, ty], previousTarget) < this.conf.targetRadius * 2
        ) {
          continue;
        }

        const distToOrigin = Math.sqrt(tx * tx + ty * ty);
        if (distToOrigin > this.w * 0.6) {
          this.setTarget(tx, ty);
          return;
        }
      }
    }

    const fallbackTargets = [
      this.defaultTarget,
      [this.w - margin, this.h - margin],
      [margin, this.h - margin],
      [this.w - margin, margin],
      [this.w / 2, this.h / 2]
    ];

    for (const [tx, ty] of fallbackTargets) {
      if (!this.targetOverlapsObstacle(tx, ty)) {
        this.setTarget(tx, ty);
        return;
      }
    }

    this.setTarget(this.defaultTarget[0], this.defaultTarget[1]);
  }

  generateNewTarget() {
    const previousTarget = [this.conf.targetX, this.conf.targetY];
    this.generateTarget(previousTarget);
    this.firstMajorityTime = -1;
  }

  reset() {
    this.swarm = [];
    this.obstacles = [];
    this.collisionCount = 0;
    this.firstMajorityTime = -1;
    this.time = 0;
    rngState = this.conf.seed;
    this.generateObstacles();
    this.generateTarget();
    this.makeSwarm();
  }

  getAngles() {
    let angles = [];
    for (let p of this.swarm) {
      const ang = 180 + (180 / Math.PI) * Math.atan2(p.dir[1], p.dir[0]);
      angles.push(ang);
    }
    return angles;
  }

  getOrderParameter() {
    if (this.swarm.length === 0) return 0;

    let sumDirX = 0;
    let sumDirY = 0;
    for (let p of this.swarm) {
      const dir = p.normalizeVector(p.vel.slice());
      sumDirX += dir[0];
      sumDirY += dir[1];
    }

    const magnitude = Math.sqrt(sumDirX * sumDirX + sumDirY * sumDirY);
    const normalizedMag = magnitude / this.swarm.length;

    return Math.min(1, normalizedMag);
  }

  targetSuccess() {
    let count = 0;
    const tx = this.conf.targetX;
    const ty = this.conf.targetY;
    const tr = this.conf.targetRadius;

    for (let p of this.swarm) {
      const d = this.dist(p.pos, [tx, ty]);
      if (d <= tr) count++;
    }
    return count / this.swarm.length;
  }

  getCrowdingPenalty() {
    if (this.swarm.length < 2) return 0;

    let penalty = 0;
    const softSpacing = this.conf.separationRadius;
    const hardSpacing = this.conf.boidRadius * 3;

    for (let i = 0; i < this.swarm.length; i++) {
      for (let j = i + 1; j < this.swarm.length; j++) {
        const d = this.dist(this.swarm[i].pos, this.swarm[j].pos);

        if (d < softSpacing) {
          const crowding = (softSpacing - d) / softSpacing;
          penalty += crowding * crowding;
        }

        if (d < hardSpacing) {
          const overlap = (hardSpacing - d) / hardSpacing;
          penalty += 2 * overlap * overlap;
        }
      }
    }

    return penalty / this.swarm.length;
  }

  checkCollisions() {
    let collisions = 0;
    for (let p of this.swarm) {
      for (let obs of this.obstacles) {
        const d = this.euclideanDist(p.pos, [obs.x, obs.y]);
        if (d < obs.radius + this.conf.boidRadius) {
          collisions++;
          break;
        }
      }
    }
    this.collisionCount += collisions;
    return collisions;
  }

  computeFitness() {
    const orderParam = this.getOrderParameter();
    const targetSuccess = this.targetSuccess();
    const crowdingPenalty = this.getCrowdingPenalty();
    const collisionRate = this.collisionCount / Math.max(1, this.time * this.swarm.length);

    let timeScore;
    if (this.firstMajorityTime !== -1) {
      timeScore = 1.0 - this.firstMajorityTime / this.conf.maxSteps;
    } else {
      timeScore = 0.0;
    }

    const fitness = 0.4 * timeScore
                  + 0.3 * orderParam
                  + 0.2 * targetSuccess
                  - 0.1 * collisionRate
                  - 0.2 * crowdingPenalty;

    return {
      fitness: Math.max(0, fitness),
      rawFitness: fitness,
      timeScore: timeScore,
      targetSuccess: targetSuccess,
      crowdingPenalty: crowdingPenalty,
      collisionRate: collisionRate,
      orderParameter: orderParam,
      collisions: this.collisionCount,
      firstMajorityTime: this.firstMajorityTime
    };
  }

  computeParameterPenalty() {
    let penalty = 0;
    const c = this.conf;
    const weights = [c.cohesion, c.alignment, c.separation, c.targetWeight, c.avoidance];
    const maxWeight = Math.max(...weights);
    const minPositiveWeight = Math.min(...weights.filter((w) => w > 1e-9));

    if (minPositiveWeight > 0) {
      const ratio = maxWeight / minPositiveWeight;
      if (ratio > 50) {
        penalty += (ratio - 50) * 0.002;
      }
    }

    if (c.separationRadius >= c.interactionRadius) {
      penalty += (c.separationRadius - c.interactionRadius + 1) * 0.02;
    }

    if (c.interactionRadius > c.obstaclePerceptionRadius) {
      penalty += (c.interactionRadius - c.obstaclePerceptionRadius) * 0.01;
    }

    return penalty;
  }

  computeOptimizationFitness() {
    const base = this.computeFitness();
    const paramPenalty = this.computeParameterPenalty();

    const fitness = base.rawFitness
                  - 0.1 * paramPenalty
                  - 0.25 * base.crowdingPenalty;

    return {
      fitness: Math.max(0, fitness),
      orderParam: base.orderParameter,
      timeScore: base.timeScore,
      targetSuccess: base.targetSuccess,
      crowdingPenalty: base.crowdingPenalty,
      collisionRate: base.collisionRate,
      paramPenalty: paramPenalty,
      weights: this.getBehaviourWeightVector()
    };
  }

  getBehaviourWeightVector() {
    const c = this.conf;
    return [c.cohesion, c.alignment, c.separation, c.targetWeight, c.avoidance, c.randomWeight];
  }

  wrapCoordinate(value, size) {
    if (size <= 0) return value;
    return ((value % size) + size) % size;
  }

  minimalImageDelta(delta, size) {
    if (size <= 0) return delta;
    return ((delta + size / 2) % size + size) % size - size / 2;
  }

  wrap(pos, reference = undefined) {
    if (typeof reference == "undefined") {
      return [
        this.wrapCoordinate(pos[0], this.w),
        this.wrapCoordinate(pos[1], this.h)
      ];
    }

    const dx = this.minimalImageDelta(pos[0] - reference[0], this.w);
    const dy = this.minimalImageDelta(pos[1] - reference[1], this.h);
    return [reference[0] + dx, reference[1] + dy];
  }

  addParticle() {
    const i = this.swarm.length;
    this.swarm.push(new Particle(this, i));
  }

  makeSwarm() {
    for (let i = 0; i < this.conf.N; i++) this.addParticle();
  }

  randomPosition() {
    for (let attempts = 0; attempts < 1000; attempts++) {
      const x = this.randomRange(this.conf.boidRadius, this.w - this.conf.boidRadius);
      const y = this.randomRange(this.conf.boidRadius, this.h - this.conf.boidRadius);
      const pos = [x, y];
      let valid = true;

      for (const obs of this.obstacles) {
        if (this.euclideanDist(pos, [obs.x, obs.y]) < obs.radius + this.conf.boidRadius + this.conf.avoidanceMargin) {
          valid = false;
          break;
        }
      }

      if (this.euclideanDist(pos, [this.conf.targetX, this.conf.targetY]) < this.conf.targetRadius + this.conf.boidRadius) {
        valid = false;
      }

      if (valid) return pos;
    }

    return [this.random() * this.w, this.random() * this.h];
  }

  normalizeVector(a) {
    let norm = 0;
    for (let i = 0; i < a.length; i++) {
      norm += a[i] * a[i];
    }
    norm = Math.sqrt(norm);

    if (norm < 1e-12) {
      return a.map(() => 0);
    }

    return a.map((x) => x / norm);
  }

  euclideanDist(pos1, pos2) {
    const dx = pos1[0] - pos2[0];
    const dy = pos1[1] - pos2[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  dist(pos1, pos2) {
    const dx = this.minimalImageDelta(pos1[0] - pos2[0], this.w);
    const dy = this.minimalImageDelta(pos1[1] - pos2[1], this.h);
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist;
  }

  neighbours(x, distanceThreshold, useFieldOfView = true) {
    let r = [];
    const fovDegrees = this.conf.fovAngle;
    const halfFovRadians = (fovDegrees / 2) * Math.PI / 180;
    const fovThreshold = Math.cos(halfFovRadians);
    for (let p of this.swarm) {
      if (p.id == x.id) continue;
      const d = this.dist(p.pos, x.pos);
      if (d <= distanceThreshold && d > 0) {
        if (!useFieldOfView) {
          r.push(p);
          continue;
        }

        const neighborPos = this.wrap(p.pos, x.pos);
        const toNeighbor = [
          neighborPos[0] - x.pos[0],
          neighborPos[1] - x.pos[1]
        ];
        const toNeighborNorm = this.normalizeVector(toNeighbor);
        const dot = x.dir[0] * toNeighborNorm[0] + x.dir[1] * toNeighborNorm[1];
        if (dot >= fovThreshold) {
          r.push(p);
        }
      }
    }
    return r;
  }

  step() {
    for (let p of this.swarm) {
      p.updateVector();
    }
    this.checkCollisions();
    for (let p of this.swarm) {
      p.resolveObstaclePenetration();
    }

    if (this.firstMajorityTime === -1) {
      const currentSuccess = this.targetSuccess();
      if (currentSuccess >= this.conf.majorityThreshold) {
        this.firstMajorityTime = this.time;
      }
    }

    this.time++;
  }
}

class Particle {
  constructor(Scene, i) {
    this.S = Scene;
    this.id = i;
    this.pos = this.S.randomPosition();
    const angle = this.S.random() * 2 * Math.PI;
    const speed = this.S.randomRange(MIN_SPEED, MAX_SPEED);
    this.vel = [
      Math.cos(angle) * speed,
      Math.sin(angle) * speed
    ];
    this.speed = speed;
    this.dir = this.normalizeVector(this.vel.slice());
  }

  addVectors(a, b) {
    const dim = a.length;
    let out = [];
    for (let d = 0; d < dim; d++) {
      out.push(a[d] + b[d]);
    }
    return out;
  }

  subtractVectors(a, b) {
    const dim = a.length;
    let out = [];
    for (let d = 0; d < dim; d++) {
      out.push(a[d] - b[d]);
    }
    return out;
  }

  multiplyVector(a, c) {
    return a.map((x) => x * c);
  }

  normalizeVector(a) {
    return this.S.normalizeVector(a);
  }

  magnitude(a) {
    return Math.sqrt(a[0] * a[0] + a[1] * a[1]);
  }

  dot(a, b) {
    return a[0] * b[0] + a[1] * b[1];
  }

  clipMagnitude(v, minMag, maxMag) {
    const mag = this.magnitude(v);

    if (mag < 1e-8) {
      return [0, 0];
    }

    const lower = Math.min(minMag, maxMag);
    const upper = Math.max(minMag, maxMag);
    const dir = this.normalizeVector(v.slice());

    if (mag > upper) {
      return this.multiplyVector(dir, upper);
    }

    if (mag < lower) {
      return this.multiplyVector(dir, lower);
    }

    return v;
  }

  limitMagnitude(v, maxMag) {
    const mag = this.magnitude(v);

    if (mag < 1e-8 || mag <= maxMag) {
      return v;
    }

    return this.multiplyVector(this.normalizeVector(v), maxMag);
  }

  cohesionVector() {
    const neighbors = this.S.neighbours(this, this.S.conf.interactionRadius);
    if (neighbors.length === 0) return [0, 0];

    let cx = 0;
    let cy = 0;

    for (const n of neighbors) {
      const npos = this.S.wrap(n.pos, this.pos);
      cx += npos[0];
      cy += npos[1];
    }

    cx /= neighbors.length;
    cy /= neighbors.length;

    const toCenter = [cx - this.pos[0], cy - this.pos[1]];
    const d = this.magnitude(toCenter);

    if (d < 1e-8) {
      return [0, 0];
    }

    const strength = Math.min(d / this.S.conf.interactionRadius, 1);
    return this.multiplyVector(this.normalizeVector(toCenter), strength);
  }

  alignmentVector() {
    const neighbors = this.S.neighbours(this, this.S.conf.interactionRadius);
    if (neighbors.length === 0) return [0, 0];

    let vx = 0;
    let vy = 0;

    for (const n of neighbors) {
      vx += n.vel[0];
      vy += n.vel[1];
    }

    vx /= neighbors.length;
    vy /= neighbors.length;

    return [vx - this.vel[0], vy - this.vel[1]];
  }

  separationVector() {
    const neighbors = this.S.neighbours(this, this.S.conf.separationRadius, false);
    if (neighbors.length === 0) return [0, 0];

    let sx = 0;
    let sy = 0;
    const eps = 1e-6;

    for (const n of neighbors) {
      const npos = this.S.wrap(n.pos, this.pos);
      const dx = this.pos[0] - npos[0];
      const dy = this.pos[1] - npos[1];
      const d2 = dx * dx + dy * dy + eps;

      sx += (dx / d2) * this.S.conf.separationRadius;
      sy += (dy / d2) * this.S.conf.separationRadius;
    }

    return this.limitMagnitude([sx, sy], MAX_SPEED);
  }

  targetVector() {
    const target = [
      this.S.conf.targetX,
      this.S.conf.targetY
    ];
    const tpos = this.S.wrap(target, this.pos);

    const dx = tpos[0] - this.pos[0];
    const dy = tpos[1] - this.pos[1];
    const d = Math.sqrt(dx * dx + dy * dy);

    if (d < this.S.conf.targetRadius) {
      return [0, 0];
    }

    const strength = Math.min(
      (d - this.S.conf.targetRadius) / Math.max(this.S.w, this.S.h),
      1
    );
    return this.multiplyVector(this.normalizeVector([dx, dy]), strength);
  }

  obstacleAvoidanceVector() {
    const c = this.S.conf;
    if (this.magnitude(this.vel) < 1e-8) return [0, 0];
    const forward = this.normalizeVector(this.vel.slice());

    let bestAvoid = [0, 0];
    let bestUrgency = 0;
    const fovCos = Math.cos((c.fovAngle * Math.PI / 180) / 2);

    for (const obs of this.S.obstacles) {
      const toObs = [obs.x - this.pos[0], obs.y - this.pos[1]];
      const distToCenter = this.magnitude(toObs);
      const safeRadius = obs.radius + c.avoidanceMargin + c.boidRadius;
      const nearRadius = safeRadius + c.boidRadius * 5;

      if (distToCenter < nearRadius) {
        const away = distToCenter > 1e-6
          ? this.normalizeVector([-toObs[0], -toObs[1]])
          : [-forward[1], forward[0]];
        const penetration = Math.max(0, safeRadius - distToCenter);
        const closeness = (nearRadius - distToCenter) / nearRadius;
        const escapeVec = this.multiplyVector(
          away,
          MAX_SPEED * (0.6 + closeness + penetration / safeRadius)
        );
        const urgency = 0.8 + closeness + penetration / safeRadius;

        if (urgency > bestUrgency) {
          bestUrgency = urgency;
          bestAvoid = escapeVec;
        }
        continue;
      }

      if (distToCenter > c.obstaclePerceptionRadius + obs.radius + c.avoidanceMargin) {
        continue;
      }

      const proj = this.dot(toObs, forward);

      if (proj <= 0 || proj > c.obstaclePerceptionRadius) {
        continue;
      }

      const toObsDir = this.normalizeVector(toObs.slice());
      const cosAngle = this.dot(forward, toObsDir);
      if (cosAngle < fovCos) {
        continue;
      }

      const closestPoint = [
        this.pos[0] + proj * forward[0],
        this.pos[1] + proj * forward[1]
      ];

      const latOffset = [
        obs.x - closestPoint[0],
        obs.y - closestPoint[1]
      ];

      const latDist = this.magnitude(latOffset);

      if (latDist >= safeRadius) {
        continue;
      }

      let latDir;
      if (latDist > 1e-6) {
        latDir = this.normalizeVector([-latOffset[0], -latOffset[1]]);
      } else {
        latDir = [-forward[1], forward[0]];
      }

      const avoidPoint = [
        obs.x + safeRadius * latDir[0] + c.forwardOffset * forward[0],
        obs.y + safeRadius * latDir[1] + c.forwardOffset * forward[1]
      ];

      const avoidVec = [
        avoidPoint[0] - this.pos[0],
        avoidPoint[1] - this.pos[1]
      ];

      const urgency = 1 - proj / c.obstaclePerceptionRadius;

      if (urgency > bestUrgency) {
        bestUrgency = urgency;
        bestAvoid = this.limitMagnitude(
          this.multiplyVector(avoidVec, urgency),
          MAX_SPEED * 2
        );
      }
    }

    return bestAvoid;
  }

  randomVector() {
    const angle = this.S.random() * 2 * Math.PI;
    return [Math.cos(angle), Math.sin(angle)];
  }

  resolveObstaclePenetration() {
    for (const obs of this.S.obstacles) {
      const dx = this.pos[0] - obs.x;
      const dy = this.pos[1] - obs.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const minD = obs.radius + this.S.conf.boidRadius;

      if (d > 1e-6 && d < minD) {
        const push = minD - d;
        const outward = [dx / d, dy / d];
        this.pos[0] += outward[0] * push;
        this.pos[1] += outward[1] * push;

        const inwardSpeed = this.dot(this.vel, outward);
        if (inwardSpeed < 0) {
          this.vel = this.subtractVectors(
            this.vel,
            this.multiplyVector(outward, inwardSpeed)
          );
        }
      }
    }
  }

  updateVector() {
    const c = this.S.conf;

    const C = this.cohesionVector();
    const A = this.alignmentVector();
    const S = this.separationVector();
    const T = this.targetVector();
    const O = this.obstacleAvoidanceVector();
    const R = this.randomVector();

    let V = [0, 0];
    const obstacleResponse = this.magnitude(O) > 1e-6;

    V = this.addVectors(V, this.multiplyVector(C, c.cohesion));
    V = this.addVectors(V, this.multiplyVector(A, c.alignment));
    V = this.addVectors(V, this.multiplyVector(S, c.separation));
    V = this.addVectors(V, this.multiplyVector(T, c.targetWeight));
    V = this.addVectors(V, this.multiplyVector(O, c.avoidance));
    V = this.addVectors(V, this.multiplyVector(R, c.randomWeight));

    // Like the reference sketch, behaviours nudge velocity over time.
    const maxAcceleration = obstacleResponse
      ? MAX_OBSTACLE_ACCELERATION
      : MAX_ACCELERATION;
    V = this.addVectors(this.vel, this.limitMagnitude(V, maxAcceleration));
    V = this.clipMagnitude(V, MIN_SPEED, MAX_SPEED);

    this.vel = V;
    this.speed = this.magnitude(V);
    this.dir = this.normalizeVector(V.slice());

    this.pos = this.addVectors(this.pos, this.vel);
    this.pos = this.S.wrap(this.pos);
  }
}

function initialize() {
  rngState = conf.seed;
  S = new Scene(conf);
  canvas = new Canvas(S, conf);
  canvas.drawSwarm();
}
