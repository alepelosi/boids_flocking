let canvas, S;
let conf = {
  w: 400,
  h: 400,
  N: 50,
  zoom: 1,
  innerRadius: 10,
  outerRadius: 25,
  cohesion: 1,
  separation: 1,
  alignment: 1,
  targetX: 350,
  targetY: 350,
  targetWeight: 0.08,
  targetRadius: 30,
};

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
      2 * Math.PI,
    );
    this.ctx.stroke();
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
        this.S.conf.innerRadius * 1.2 * zoom,
      );
      drawVec = p.addVectors(startPoint, drawVec);

      ctx.moveTo(startPoint[0], startPoint[1]);
      ctx.lineTo(drawVec[0], drawVec[1]);
    }
    ctx.stroke();
  }

  drawSwarm() {
    this.background("eaecef");
    this.drawTarget();
    for (let p of this.S.swarm) {
      this.fillCircle(p.pos, "ff0000");
      this.drawCircle(p.pos, "aaaaaa", this.S.conf.outerRadius);
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
    this.makeSwarm();
    this.time = 0;
  }

  reset() {
    this.swarm = [];
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

  wrap(pos, reference = undefined) {
    // wrapping without a reference: just make sure the coordinate falls within
    // the space
    if (typeof reference == "undefined") {
      if (pos[0] < 0) pos[0] += this.w;
      if (pos[1] < 0) pos[1] += this.h;
      if (pos[0] > this.w) pos[0] -= this.w;
      if (pos[1] > this.h) pos[1] -= this.h;

      return pos;
    }

    // otherwise: make coordinates consistent compared to a reference position
    // we don't want to overwrite the 'pos' object itself (!JavaScript) so deep copy it first
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
    //const dist = Math.hypot(pos2[0] - pos1[0], pos2[1] - pos1[1] )
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
    this.time++;

    if (this.time % 20 === 0) {
      console.log("time:", this.time, "targetSuccess:", this.targetSuccess());
    }
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

  // return a + b
  addVectors(a, b) {
    const dim = a.length;
    let out = [];
    for (let d = 0; d < dim; d++) {
      out.push(a[d] + b[d]);
    }
    return out;
  }

  // return a - b
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

    // no pull if already inside target
    if (d <= this.S.conf.targetRadius) return [0, 0];

    // attraction gets weaker near the target
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

  // multiply vector by a constant
  multiplyVector(a, c) {
    return a.map((x) => x * c);
  }

  // normalize vector to unit length
  normalizeVector(a) {
    return this.S.normalizeVector(a);
  }

  // average neighbor direction
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

  // direction toward neighbors' center of mass, torus-correct
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

  // direction away from close neighbors, weighted by inverse distance
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

    const align = this.multiplyVector(
      this.alignmentVector(this.S.conf.outerRadius),
      align_weight,
    );

    const cohesion = this.multiplyVector(
      this.cohesionVector(this.S.conf.outerRadius),
      cohesion_weight,
    );

    const separation = this.multiplyVector(
      this.separationVector(this.S.conf.innerRadius),
      separation_weight,
    );

    const target = this.multiplyVector(
      this.targetVector(),
      this.S.conf.targetWeight,
    );

    // combine current direction with steering terms
    let newDir = this.addVectors(this.dir, align);
    newDir = this.addVectors(newDir, cohesion);
    newDir = this.addVectors(newDir, separation);
    newDir = this.addVectors(newDir, target);

    // keep constant speed by normalizing direction
    this.dir = this.normalizeVector(newDir);

    // move and wrap around the torus boundary
    const movement = this.multiplyVector(this.dir, this.speed);
    this.pos = this.addVectors(this.pos, movement);
    this.pos = this.S.wrap(this.pos);
  }
}

function initialize() {
  S = new Scene(conf);
  canvas = new Canvas(S, conf);
  canvas.drawSwarm();

  let angles = [];

  let trace = {
    x: angles,
    type: "histogram",
  };

  let data = [trace];
  let layout = {
    xaxis: { range: [0, 2 * Math.PI] },
  };

  Plotly.newPlot("myDiv", data, layout);
}
