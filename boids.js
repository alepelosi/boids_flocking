let canvas, S;
let conf = {
  w: 400,
  h: 400,
  N: 50,
  zoom: 1,
  innerRadius: 10,
  outerRadius: 25,
  perceptionRadius: 25,
  cohesion: 1,
  separation: 1,
  alignment: 1,
  avoidance: 1,
  targetX: 350,
  targetY: 350,
  targetWeight: 0.08,
  targetRadius: 30,
  numObstacles: 5,
  obstacleRadius: 25,
  seed: 12345,
  maxSteps: 500,
  majorityThreshold: 0.8,
  failurePenalty: 2
};

let rngState = conf.seed;

function seededRandom() {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

function seededRandomRange(min, max) {
  return min + seededRandom() * (max - min);
}

function generateObstacles() {
  const obstacles = [];
  const margin = conf.obstacleRadius + 20;
  const targetMargin = conf.targetRadius + 30;

  for (let i = 0; i < conf.numObstacles; i++) {
    let attempts = 0;
    let valid = false;
    let ox, oy;

    while (!valid && attempts < 100) {
      ox = seededRandomRange(margin, conf.w - margin);
      oy = seededRandomRange(margin, conf.h - margin);

      const distToOrigin = Math.sqrt(ox * ox + oy * oy);

      if (distToOrigin > margin) {
        valid = true;
        for (let obs of obstacles) {
          const dist = Math.sqrt(Math.pow(ox - obs.x, 2) + Math.pow(oy - obs.y, 2));
          if (dist < conf.obstacleRadius * 2 + 20) {
            valid = false;
            break;
          }
        }
      }
      attempts++;
    }

    if (valid) {
      obstacles.push({ x: ox, y: oy, radius: conf.obstacleRadius });
    }
  }
  return obstacles;
}

function generateTarget(obstacles) {
  const margin = conf.targetRadius + 30;

  for (let attempts = 0; attempts < 100; attempts++) {
    const tx = seededRandomRange(margin, conf.w - margin);
    const ty = seededRandomRange(margin, conf.h - margin);

    let valid = true;
    for (let obs of obstacles) {
      const dist = Math.sqrt(Math.pow(tx - obs.x, 2) + Math.pow(ty - obs.y, 2));
      if (dist < obs.radius + conf.targetRadius + 20) {
        valid = false;
        break;
      }
    }

    if (valid) {
      const distToOrigin = Math.sqrt(tx * tx + ty * ty);
      if (distToOrigin > conf.w * 0.6) {
        return { x: tx, y: ty };
      }
    }
  }

  return { x: conf.targetX, y: conf.targetY };
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

  fillCircle(pos, col) {
    this.ctx.fillStyle = "#" + col;
    this.ctx.beginPath();
    this.ctx.arc(pos[0], pos[1], this.S.conf.innerRadius / 2, 0, 2 * Math.PI);
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

      let drawVec = p.multiplyVector(
        p.dir,
        this.S.conf.innerRadius * 1.2 * zoom
      );
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
      this.fillCircle(p.pos, "ff0000");
      this.drawCircle(p.pos, "aaaaaa", this.S.conf.perceptionRadius);
    }
    this.drawDirections();
  }
}

class Scene {
  constructor(conf) {
    this.w = conf.w;
    this.h = conf.h;
    this.conf = conf;
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

  generateObstacles() {
    const margin = this.conf.obstacleRadius + 20;
    this.obstacles = [];

    for (let i = 0; i < this.conf.numObstacles; i++) {
      let attempts = 0;
      let valid = false;
      let ox, oy;

      while (!valid && attempts < 100) {
        ox = margin + seededRandom() * (this.w - 2 * margin);
        oy = margin + seededRandom() * (this.h - 2 * margin);

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

  generateTarget() {
    const margin = this.conf.targetRadius + 30;

    for (let attempts = 0; attempts < 100; attempts++) {
      const tx = margin + seededRandom() * (this.w - 2 * margin);
      const ty = margin + seededRandom() * (this.h - 2 * margin);

      let valid = true;
      for (let obs of this.obstacles) {
        const dist = Math.sqrt(Math.pow(tx - obs.x, 2) + Math.pow(ty - obs.y, 2));
        if (dist < obs.radius + this.conf.targetRadius + 20) {
          valid = false;
          break;
        }
      }

      if (valid) {
        const distToOrigin = Math.sqrt(tx * tx + ty * ty);
        if (distToOrigin > this.w * 0.6) {
          this.conf.targetX = tx;
          this.conf.targetY = ty;
          return;
        }
      }
    }
  }

  reset() {
    this.swarm = [];
    this.collisionCount = 0;
    this.firstMajorityTime = -1;
    this.time = 0;
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
      sumDirX += p.dir[0];
      sumDirY += p.dir[1];
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

  checkCollisions() {
    let collisions = 0;
    for (let p of this.swarm) {
      for (let obs of this.obstacles) {
        const d = this.dist(p.pos, [obs.x, obs.y]);
        if (d < obs.radius + this.conf.innerRadius / 2) {
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
    const collisionPenalty = this.collisionCount / Math.max(1, this.time);

    let timePenalty;
    if (this.firstMajorityTime !== -1) {
      timePenalty = this.firstMajorityTime / this.conf.maxSteps;
    } else {
      timePenalty = 1.0 + this.conf.failurePenalty;
    }

    const fitness = 0.6 * timePenalty + 0.25 * orderParam - 0.15 * collisionPenalty;

    return {
      fitness: fitness,
      timePenalty: timePenalty,
      orderParameter: orderParam,
      collisions: this.collisionCount,
      firstMajorityTime: this.firstMajorityTime
    };
  }

  wrap(pos, reference = undefined) {
    if (typeof reference == "undefined") {
      if (pos[0] < 0) pos[0] += this.w;
      if (pos[1] < 0) pos[1] += this.h;
      if (pos[0] > this.w) pos[0] -= this.w;
      if (pos[1] > this.h) pos[1] -= this.h;
      return pos;
    }

    const pos2 = pos.slice();
    let dx = pos2[0] - reference[0],
      dy = pos2[1] - reference[1];
    if (dx > this.w / 2) pos2[0] -= this.w;
    if (dx < -this.w / 2) pos2[0] += this.w;
    if (dy > this.h / 2) pos2[1] -= this.h;
    if (dy < -this.h / 2) pos2[1] += this.h;

    return pos2;
  }

  addParticle() {
    const i = this.swarm.length + 1;
    this.swarm.push(new Particle(this, i));
  }

  makeSwarm() {
    for (let i = 0; i < this.conf.N; i++) this.addParticle();
  }

  randomPosition() {
    let x = Math.random() * this.w;
    let y = Math.random() * this.h;
    return [x, y];
  }

  randomDirection(dim = 2) {
    let dir = [];
    while (dim-- > 0) {
      dir.push(this.sampleNorm());
    }
    this.normalizeVector(dir);
    return dir;
  }

  normalizeVector(a) {
    if (a[0] == 0 && a[1] == 0) return [0, 0];

    let norm = 0;
    for (let i = 0; i < a.length; i++) {
      norm += a[i] * a[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < a.length; i++) {
      a[i] /= norm;
    }
    return a;
  }

  sampleNorm(mu = 0, sigma = 1) {
    let u1 = Math.random();
    let u2 = Math.random();
    let z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
    return z0 * sigma + mu;
  }

  dist(pos1, pos2) {
    let dx = pos1[0] - pos2[0];
    if (dx > this.w / 2) {
      dx -= this.w;
    }
    if (dx < -this.w / 2) {
      dx += this.w;
    }

    let dy = pos1[1] - pos2[1];
    if (dy > this.h / 2) {
      dy -= this.h;
    }
    if (dy < -this.h / 2) {
      dy += this.h;
    }

    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist;
  }

  neighbours(x, distanceThreshold) {
    let r = [];
    for (let p of this.swarm) {
      if (p.id == x.id) continue;

      if (this.dist(p.pos, x.pos) <= distanceThreshold) {
        r.push(p);
      }
    }
    return r;
  }

  step() {
    for (let p of this.swarm) {
      p.updateVector();
    }
    this.checkCollisions();

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
    this.speed = 1;
    this.id = i;
    this.pos = this.S.randomPosition();
    this.dir = this.S.randomDirection();
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

  targetVector() {
    const target = [this.S.conf.targetX, this.S.conf.targetY];
    const tpos = this.S.wrap(target, this.pos);

    const dx = tpos[0] - this.pos[0];
    const dy = tpos[1] - this.pos[1];
    const d = Math.sqrt(dx * dx + dy * dy);

    if (d <= this.S.conf.targetRadius) return [0, 0];

    const slowRadius = 100;
    let strength = 1.0;

    if (d < slowRadius) {
      strength =
        (d - this.S.conf.targetRadius) /
        (slowRadius - this.S.conf.targetRadius);
      strength = Math.max(0, Math.min(1, strength));
    }

    const dir = [dx / d, dy / d];
    return this.multiplyVector(dir, strength);
  }

  avoidanceVector() {
    let steer = [0, 0];
    const perceptionR = this.S.conf.perceptionRadius;

    for (let obs of this.S.obstacles) {
      const dx = this.pos[0] - obs.x;
      const dy = this.pos[1] - obs.y;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (d < perceptionR + obs.radius && d > 0) {
        const strength = (perceptionR + obs.radius - d) / perceptionR;
        const dir = [dx / d, dy / d];
        steer = this.addVectors(steer, this.multiplyVector(dir, strength));
      }
    }

    return this.S.normalizeVector(steer);
  }

  multiplyVector(a, c) {
    return a.map((x) => x * c);
  }

  normalizeVector(a) {
    return this.S.normalizeVector(a);
  }

  alignmentVector(neighborRadius) {
    const neighbors = this.S.neighbours(this, neighborRadius);
    if (neighbors.length === 0) return [0, 0];

    let avg = [0, 0];
    for (const n of neighbors) {
      avg = this.addVectors(avg, n.dir);
    }
    avg = this.multiplyVector(avg, 1 / neighbors.length);
    return this.normalizeVector(avg);
  }

  cohesionVector(neighborRadius) {
    const neighbors = this.S.neighbours(this, neighborRadius);
    if (neighbors.length === 0) return [0, 0];

    let avgPos = [0, 0];
    for (const n of neighbors) {
      const npos = this.S.wrap(n.pos, this.pos);
      avgPos = this.addVectors(avgPos, npos);
    }
    avgPos = this.multiplyVector(avgPos, 1 / neighbors.length);

    const steer = this.subtractVectors(avgPos, this.pos);
    return this.normalizeVector(steer);
  }

  separationVector(neighborRadius) {
    const neighbors = this.S.neighbours(this, neighborRadius);
    if (neighbors.length === 0) return [0, 0];

    let steer = [0, 0];
    for (const n of neighbors) {
      const npos = this.S.wrap(n.pos, this.pos);
      const diff = this.subtractVectors(this.pos, npos);
      const d = this.S.dist(this.pos, n.pos);

      if (d > 1e-9) {
        steer = this.addVectors(steer, this.multiplyVector(diff, 1 / d));
      }
    }
    return this.normalizeVector(steer);
  }

  updateVector() {
    const align_weight = this.S.conf.alignment;
    const cohesion_weight = this.S.conf.cohesion;
    const separation_weight = this.S.conf.separation;
    const avoidance_weight = this.S.conf.avoidance;
    const perceptionR = this.S.conf.perceptionRadius;

    const align = this.multiplyVector(
      this.alignmentVector(perceptionR),
      align_weight
    );

    const cohesion = this.multiplyVector(
      this.cohesionVector(perceptionR),
      cohesion_weight
    );

    const separation = this.multiplyVector(
      this.separationVector(perceptionR),
      separation_weight
    );

    const avoidance = this.multiplyVector(
      this.avoidanceVector(),
      avoidance_weight
    );

    const target = this.multiplyVector(
      this.targetVector(),
      this.S.conf.targetWeight
    );

    let newDir = this.addVectors(this.dir, align);
    newDir = this.addVectors(newDir, cohesion);
    newDir = this.addVectors(newDir, separation);
    newDir = this.addVectors(newDir, avoidance);
    newDir = this.addVectors(newDir, target);

    this.dir = this.normalizeVector(newDir);

    const movement = this.multiplyVector(this.dir, this.speed);
    this.pos = this.addVectors(this.pos, movement);
    this.pos = this.S.wrap(this.pos);
  }
}

function initialize() {
  rngState = conf.seed;
  S = new Scene(conf);
  canvas = new Canvas(S, conf);
  canvas.drawSwarm();
}
