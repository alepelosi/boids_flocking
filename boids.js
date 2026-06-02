const MIN_SPEED = 0.5;
const MAX_SPEED = 3.0;
const MAX_ACCELERATION = 0.12;
const MAX_OBSTACLE_ACCELERATION = 0.55;
const TARGET_STRENGTH_DISTANCE = 300;
const RETARGET_BOOST_STEPS = 120;
const RETARGET_WEIGHT_BOOST = 0.12;
const RETARGET_MIN_TARGET_WEIGHT = 0.18;
const MAX_TARGET_WEIGHT = 1;
const RETARGET_VELOCITY_BLEND = 0;
const TARGET_EDGE_PADDING = 12;
const TARGET_OBSTACLE_PADDING = 12;
const TARGET_PLACEMENT_ATTEMPTS = 500;
const COLLISION_FITNESS_PENALTY_WEIGHT = 0.02;

let canvas, S;
let conf = {
  w: 950,
  h: 950,
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
  targetRadius: 95,
  targetArrivalRadius: 150,
  targetEdgePadding: TARGET_EDGE_PADDING,
  targetObstaclePadding: TARGET_OBSTACLE_PADDING,
  numObstacles: 8,
  obstacleRadius: 35,
  seed: 12345,
  maxSteps: 1000,
  majorityThreshold: 0.65,
  targetVisibleBoids: 1,
  leaderFollowWeight: 0.45,
  leaderPreferredDistance: 90,
  leaderInfluenceRadius: 320,
  failurePenalty: 2,
  fovAngle: 135,
  avoidanceMargin: 10,
  forwardOffset: 20,
  randomWeight: 0.015,
  showInteractionRadius: false,
  autoRetargetOnMajority: true
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
    const ctx = this.ctx;
    const x = this.S.conf.targetX;
    const y = this.S.conf.targetY;
    const r = this.S.targetArrivalRadius();

    ctx.save();
    ctx.fillStyle = "rgba(0, 130, 70, 0.10)";
    ctx.strokeStyle = "#087a46";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
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

  fillCircle(pos, col, radius, strokeCol = "000000") {
    this.ctx.fillStyle = "#" + col;
    this.ctx.strokeStyle = "#" + strokeCol;
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
    const targetVisibleBoids = Math.max(0, Math.round(this.S.conf.targetVisibleBoids || 0));
    for (let p of this.S.swarm) {
      if (this.S.conf.showInteractionRadius) {
        this.drawCircle(p.pos, "aaaaaa", this.S.conf.interactionRadius);
      }
      const isLeader = p.id < targetVisibleBoids;
      const color = isLeader ? "0066ff" : "ff0000";
      const radius = isLeader ? this.S.conf.boidRadius * 1.35 : this.S.conf.boidRadius;
      this.fillCircle(p.pos, color, radius);
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
    this.bestTargetApproachScore = 0;
    this.targetApproachAccumulator = 0;
    this.bestLeaderTargetApproachScore = 0;
    this.leaderTargetApproachAccumulator = 0;
    this.leaderTargetArrivalAccumulator = 0;
    this.leaderFollowAccumulator = 0;
    this.bestTargetArrivalSuccess = 0;
    this.targetArrivalSuccessAccumulator = 0;
    this.targetTrackingSteps = 0;
    this.targetChangedAt = -Infinity;
    this.targetCompletionCount = 0;
    this.lastTargetCompletionTime = -1;
    this.lastTargetChangeInterval = -1;
    this.targetChangeIntervals = [];
    this.targetCompletionHistory = [];
    this.time = 0;
    this.clearMetricCache();
    rngState = conf.seed;
    this.generateObstacles();
    this.generateTarget();
    this.targetChangedAt = 0;
    this.makeSwarm();
  }

  random() {
    return seededRandom();
  }

  randomRange(min, max) {
    return min + this.random() * (max - min);
  }

  clearMetricCache() {
    this.spatialMetricsCache = null;
    this.spatialMetricsCacheTime = -1;
    this.speedMetricsCache = null;
    this.speedMetricsCacheTime = -1;
    this.obstacleClearanceCache = null;
    this.obstacleClearanceCacheTime = -1;
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

  targetPlacementMargin() {
    return this.targetArrivalRadius() + (this.conf.targetEdgePadding || TARGET_EDGE_PADDING);
  }

  targetObstacleClearance(tx, ty) {
    const targetRadius = this.targetArrivalRadius();
    let minClearance = Infinity;

    for (let obs of this.obstacles) {
      const dist = Math.sqrt(Math.pow(tx - obs.x, 2) + Math.pow(ty - obs.y, 2));
      minClearance = Math.min(minClearance, dist - obs.radius - targetRadius);
    }

    return minClearance;
  }

  targetFlockFraction(tx, ty) {
    if (!this.swarm || this.swarm.length === 0) return 0;

    let count = 0;
    const targetRadius = this.targetArrivalRadius();

    for (const p of this.swarm) {
      if (this.euclideanDist(p.pos, [tx, ty]) <= targetRadius) {
        count++;
      }
    }

    return count / this.swarm.length;
  }

  targetPlacementScore(tx, ty, previousTarget) {
    const obstacleClearance = this.targetObstacleClearance(tx, ty);
    const edgeClearance = Math.min(tx, this.w - tx, ty, this.h - ty) - this.targetArrivalRadius();
    const flockFraction = this.targetFlockFraction(tx, ty);
    const requiredClearance = this.conf.targetObstaclePadding || TARGET_OBSTACLE_PADDING;
    const maxInitialFraction = 0.2;
    const previousDistance = previousTarget
      ? this.euclideanDist([tx, ty], previousTarget)
      : this.w + this.h;
    const minPreviousDistance = this.targetArrivalRadius() * 2;

    let score = 0;
    score += Math.min(260, obstacleClearance) * 5;
    score += edgeClearance * 0.75;
    score += Math.min(previousDistance, 400) * 0.5;
    score -= flockFraction * 900;

    if (obstacleClearance < requiredClearance) {
      score -= (requiredClearance - obstacleClearance) * 220;
    }

    if (flockFraction > maxInitialFraction) {
      score -= (flockFraction - maxInitialFraction) * 4000;
    }

    if (previousTarget && previousDistance < minPreviousDistance) {
      score -= (minPreviousDistance - previousDistance) * 20;
    }

    return {
      score,
      obstacleSafe: obstacleClearance >= requiredClearance && edgeClearance >= 0,
      valid:
        obstacleClearance >= requiredClearance &&
        edgeClearance >= 0 &&
        flockFraction <= maxInitialFraction &&
        (!previousTarget || previousDistance >= minPreviousDistance)
    };
  }

  bestGridTarget(previousTarget, margin) {
    const gridSteps = 8;
    let best = null;

    for (let gx = 0; gx < gridSteps; gx++) {
      for (let gy = 0; gy < gridSteps; gy++) {
        const tx = margin + (gx / (gridSteps - 1)) * (this.w - margin * 2);
        const ty = margin + (gy / (gridSteps - 1)) * (this.h - margin * 2);
        const candidate = this.targetPlacementScore(tx, ty, previousTarget);

        if (!best || candidate.score > best.score) {
          best = {
            tx,
            ty,
            score: candidate.score,
            valid: candidate.valid,
            obstacleSafe: candidate.obstacleSafe
          };
        }

        if (candidate.valid) {
          return {
            tx,
            ty,
            score: candidate.score,
            valid: true,
            obstacleSafe: candidate.obstacleSafe
          };
        }
      }
    }

    return best;
  }

  setTarget(tx, ty) {
    const radius = this.targetPlacementMargin();
    const clampInside = function(value, size) {
      if (size <= radius * 2) return size / 2;
      return Math.max(radius, Math.min(size - radius, value));
    };

    this.conf.targetX = clampInside(tx, this.w);
    this.conf.targetY = clampInside(ty, this.h);
  }

  generateTarget(previousTarget = undefined) {
    const margin = this.targetPlacementMargin();
    let bestCandidate = null;
    let bestSafeCandidate = null;

    for (let attempts = 0; attempts < TARGET_PLACEMENT_ATTEMPTS; attempts++) {
      const tx = this.randomRange(margin, this.w - margin);
      const ty = this.randomRange(margin, this.h - margin);
      const candidate = this.targetPlacementScore(tx, ty, previousTarget);

      if (!bestCandidate || candidate.score > bestCandidate.score) {
        bestCandidate = { tx, ty, score: candidate.score, valid: candidate.valid };
      }

      if (
        candidate.obstacleSafe &&
        (!bestSafeCandidate || candidate.score > bestSafeCandidate.score)
      ) {
        bestSafeCandidate = {
          tx,
          ty,
          score: candidate.score,
          valid: candidate.valid,
          obstacleSafe: candidate.obstacleSafe
        };
      }

      if (candidate.valid) {
        this.setTarget(tx, ty);
        return;
      }
    }

    const gridCandidate = this.bestGridTarget(previousTarget, margin);
    if (gridCandidate && (!bestCandidate || gridCandidate.score > bestCandidate.score)) {
      bestCandidate = gridCandidate;
    }

    if (
      gridCandidate &&
      gridCandidate.obstacleSafe &&
      (!bestSafeCandidate || gridCandidate.score > bestSafeCandidate.score)
    ) {
      bestSafeCandidate = gridCandidate;
    }

    if (bestSafeCandidate) {
      this.setTarget(bestSafeCandidate.tx, bestSafeCandidate.ty);
      return;
    }

    if (bestCandidate) {
      this.setTarget(bestCandidate.tx, bestCandidate.ty);
      return;
    }

    this.setTarget(this.defaultTarget[0], this.defaultTarget[1]);
  }

  generateNewTarget() {
    const previousTarget = [this.conf.targetX, this.conf.targetY];
    this.generateTarget(previousTarget);
    this.resetTargetTracking();
    this.targetChangedAt = this.time;
    this.reorientSwarmTowardTarget(RETARGET_VELOCITY_BLEND);
  }

  completeCurrentTarget(successFraction) {
    const interval = this.recordTargetChangeInterval();
    this.targetCompletionCount++;
    this.lastTargetCompletionTime = this.time;
    this.targetCompletionHistory.push({
      time: this.time,
      interval: interval,
      targetX: this.conf.targetX,
      targetY: this.conf.targetY,
      successFraction: successFraction
    });
    this.generateNewTarget();
  }

  recordTargetChangeInterval() {
    const changedAt = Number.isFinite(this.targetChangedAt) ? this.targetChangedAt : 0;
    const interval = Math.max(0, this.time - changedAt);
    this.lastTargetChangeInterval = interval;
    this.targetChangeIntervals.push(interval);
    return interval;
  }

  resetTargetTracking() {
    this.firstMajorityTime = -1;
    this.bestTargetApproachScore = 0;
    this.targetApproachAccumulator = 0;
    this.bestLeaderTargetApproachScore = 0;
    this.leaderTargetApproachAccumulator = 0;
    this.leaderTargetArrivalAccumulator = 0;
    this.leaderFollowAccumulator = 0;
    this.bestTargetArrivalSuccess = 0;
    this.targetArrivalSuccessAccumulator = 0;
    this.targetTrackingSteps = 0;
  }

  reset() {
    this.swarm = [];
    this.obstacles = [];
    this.collisionCount = 0;
    this.resetTargetTracking();
    this.targetChangedAt = -Infinity;
    this.targetCompletionCount = 0;
    this.lastTargetCompletionTime = -1;
    this.lastTargetChangeInterval = -1;
    this.targetChangeIntervals = [];
    this.targetCompletionHistory = [];
    this.time = 0;
    this.clearMetricCache();
    rngState = this.conf.seed;
    this.generateObstacles();
    this.generateTarget();
    this.targetChangedAt = 0;
    this.makeSwarm();
  }

  retargetBoost() {
    const age = this.time - this.targetChangedAt;
    if (age < 0 || age > RETARGET_BOOST_STEPS) return 0;
    return RETARGET_WEIGHT_BOOST * (1 - age / RETARGET_BOOST_STEPS);
  }

  effectiveTargetWeight() {
    const boost = this.retargetBoost();
    if (boost <= 0) return Math.min(MAX_TARGET_WEIGHT, this.conf.targetWeight);
    return Math.min(
      MAX_TARGET_WEIGHT,
      Math.max(this.conf.targetWeight, RETARGET_MIN_TARGET_WEIGHT) + boost
    );
  }

  reorientSwarmTowardTarget(blend) {
    for (const p of this.swarm) {
      const toTarget = [
        this.conf.targetX - p.pos[0],
        this.conf.targetY - p.pos[1]
      ];
      const d = p.magnitude(toTarget);
      if (d < 1e-8) continue;

      const speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, p.speed || MIN_SPEED));
      const desiredVelocity = p.multiplyVector(p.normalizeVector(toTarget), speed);
      const blendedVelocity = p.addVectors(
        p.multiplyVector(p.vel, 1 - blend),
        p.multiplyVector(desiredVelocity, blend)
      );

      p.vel = p.clipMagnitude(blendedVelocity, MIN_SPEED, MAX_SPEED);
      p.speed = p.magnitude(p.vel);
      p.dir = p.normalizeVector(p.vel.slice());
    }
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

  targetDistance(pos) {
    return this.euclideanDist(pos, [this.conf.targetX, this.conf.targetY]);
  }

  leaderCount() {
    return Math.max(0, Math.min(
      this.swarm.length,
      Math.round(this.conf.targetVisibleBoids || 0)
    ));
  }

  leaders() {
    const count = this.leaderCount();
    return this.swarm.filter((p) => p.id < count);
  }

  followers() {
    const count = this.leaderCount();
    return this.swarm.filter((p) => p.id >= count);
  }

  nearestLeader(particle) {
    const leaders = this.leaders();
    let best = null;
    let bestDistance = Infinity;

    for (const leader of leaders) {
      if (leader.id === particle.id) continue;

      const d = this.dist(particle.pos, leader.pos);
      if (d < bestDistance) {
        best = leader;
        bestDistance = d;
      }
    }

    return { leader: best, distance: bestDistance };
  }

  targetArrivalRadius() {
    return Math.max(
      this.conf.targetRadius,
      this.conf.targetArrivalRadius || this.conf.targetRadius
    );
  }

  targetArrivalSuccess() {
    let count = 0;
    const tr = this.targetArrivalRadius();

    for (let p of this.swarm) {
      const d = this.targetDistance(p.pos);
      if (d <= tr) count++;
    }
    return count / this.swarm.length;
  }

  leaderTargetArrivalSuccess() {
    const leaders = this.leaders();
    if (leaders.length === 0) return 0;

    let count = 0;
    const tr = this.targetArrivalRadius();

    for (const p of leaders) {
      if (this.targetDistance(p.pos) <= tr) count++;
    }

    return count / leaders.length;
  }

  targetApproachScore() {
    if (this.swarm.length === 0) return 0;

    const tr = this.targetArrivalRadius();
    const maxDistance = Math.sqrt(this.w * this.w + this.h * this.h);
    const denom = Math.max(1, maxDistance - tr);
    let score = 0;

    for (const p of this.swarm) {
      const d = this.targetDistance(p.pos);
      const progress = 1 - Math.min(1, Math.max(0, (d - tr) / denom));
      score += progress * progress;
    }

    return score / this.swarm.length;
  }

  leaderTargetApproachScore() {
    const leaders = this.leaders();
    if (leaders.length === 0) return 0;

    const tr = this.targetArrivalRadius();
    const maxDistance = Math.sqrt(this.w * this.w + this.h * this.h);
    const denom = Math.max(1, maxDistance - tr);
    let score = 0;

    for (const p of leaders) {
      const d = this.targetDistance(p.pos);
      const progress = 1 - Math.min(1, Math.max(0, (d - tr) / denom));
      score += progress * progress;
    }

    return score / leaders.length;
  }

  leaderFollowScore() {
    const followers = this.followers();
    if (followers.length === 0 || this.leaderCount() === 0) return 1;

    const preferred = Math.max(1, this.conf.leaderPreferredDistance || this.conf.interactionRadius);
    const influence = Math.max(
      preferred + 1,
      this.conf.leaderInfluenceRadius || this.conf.interactionRadius * 4
    );
    let score = 0;

    for (const p of followers) {
      const nearest = this.nearestLeader(p);
      if (!nearest.leader || !Number.isFinite(nearest.distance)) continue;

      const excess = Math.max(0, nearest.distance - preferred);
      score += 1 - Math.min(1, excess / (influence - preferred));
    }

    return score / followers.length;
  }

  averageTargetArrivalSuccess() {
    return this.targetArrivalSuccessAccumulator / Math.max(1, this.targetTrackingSteps);
  }

  averageTargetChangeInterval() {
    return this.mean(this.targetChangeIntervals);
  }

  targetChangeIntervalStd() {
    return this.standardDeviation(this.targetChangeIntervals);
  }

  averageTargetApproachScore() {
    return this.targetApproachAccumulator / Math.max(1, this.targetTrackingSteps);
  }

  averageLeaderTargetApproachScore() {
    return this.leaderTargetApproachAccumulator / Math.max(1, this.targetTrackingSteps);
  }

  averageLeaderTargetArrivalSuccess() {
    return this.leaderTargetArrivalAccumulator / Math.max(1, this.targetTrackingSteps);
  }

  averageLeaderFollowScore() {
    return this.leaderFollowAccumulator / Math.max(1, this.targetTrackingSteps);
  }

  mean(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  median(values) {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  standardDeviation(values) {
    if (values.length <= 1) return 0;
    const avg = this.mean(values);
    return Math.sqrt(this.mean(values.map((value) => Math.pow(value - avg, 2))));
  }

  getSpatialMetrics() {
    if (
      this.spatialMetricsCache &&
      this.spatialMetricsCacheTime === this.time
    ) {
      return this.spatialMetricsCache;
    }

    const n = this.swarm.length;
    if (n === 0) {
      const emptyMetrics = {
        meanNearestNeighborDistance: 0,
        medianNearestNeighborDistance: 0,
        minNearestNeighborDistance: 0,
        spacingScore: 0,
        flockComponents: 0,
        largestClusterFraction: 0,
        fragmentationPenalty: 0,
        crowdingPenalty: 0
      };
      this.spatialMetricsCache = emptyMetrics;
      this.spatialMetricsCacheTime = this.time;
      return emptyMetrics;
    }

    if (n === 1) {
      const singleMetrics = {
        meanNearestNeighborDistance: 0,
        medianNearestNeighborDistance: 0,
        minNearestNeighborDistance: 0,
        spacingScore: 1,
        flockComponents: 1,
        largestClusterFraction: 1,
        fragmentationPenalty: 0,
        crowdingPenalty: 0
      };
      this.spatialMetricsCache = singleMetrics;
      this.spatialMetricsCacheTime = this.time;
      return singleMetrics;
    }

    let penalty = 0;
    const softSpacing = this.conf.separationRadius;
    const hardSpacing = this.conf.boidRadius * 3;
    const nearestDistances = new Array(n).fill(Infinity);
    const adjacency = Array.from({ length: n }, () => []);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = this.dist(this.swarm[i].pos, this.swarm[j].pos);

        nearestDistances[i] = Math.min(nearestDistances[i], d);
        nearestDistances[j] = Math.min(nearestDistances[j], d);

        if (d <= this.conf.interactionRadius) {
          adjacency[i].push(j);
          adjacency[j].push(i);
        }

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

    const visited = new Array(n).fill(false);
    let components = 0;
    let largestCluster = 0;

    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;

      components++;
      let size = 0;
      const stack = [i];
      visited[i] = true;

      while (stack.length > 0) {
        const current = stack.pop();
        size++;

        for (const neighbor of adjacency[current]) {
          if (!visited[neighbor]) {
            visited[neighbor] = true;
            stack.push(neighbor);
          }
        }
      }

      largestCluster = Math.max(largestCluster, size);
    }

    const finiteNearest = nearestDistances.filter((d) => Number.isFinite(d));
    const largestClusterFraction = largestCluster / n;
    const minNonOverlapSpacing = this.conf.boidRadius * 2;
    const desiredSpacing = Math.max(minNonOverlapSpacing + 1, this.conf.separationRadius);
    const spacingRange = desiredSpacing - minNonOverlapSpacing;
    const meanSpacingScore = Math.min(
      1,
      Math.max(0, (this.mean(finiteNearest) - minNonOverlapSpacing) / spacingRange)
    );
    const medianSpacingScore = Math.min(
      1,
      Math.max(0, (this.median(finiteNearest) - minNonOverlapSpacing) / spacingRange)
    );
    const minSpacingScore = Math.min(
      1,
      Math.max(0, (Math.min(...finiteNearest) - this.conf.boidRadius) / this.conf.boidRadius)
    );
    const spacingScore = this.mean([
      meanSpacingScore,
      medianSpacingScore,
      minSpacingScore
    ]);

    const metrics = {
      meanNearestNeighborDistance: this.mean(finiteNearest),
      medianNearestNeighborDistance: this.median(finiteNearest),
      minNearestNeighborDistance: Math.min(...finiteNearest),
      spacingScore: spacingScore,
      flockComponents: components,
      largestClusterFraction: largestClusterFraction,
      fragmentationPenalty: 1 - largestClusterFraction,
      crowdingPenalty: penalty / n
    };
    this.spatialMetricsCache = metrics;
    this.spatialMetricsCacheTime = this.time;
    return metrics;
  }

  getSpeedMetrics() {
    if (
      this.speedMetricsCache &&
      this.speedMetricsCacheTime === this.time
    ) {
      return this.speedMetricsCache;
    }

    const speeds = this.swarm.map((p) => p.speed || Math.sqrt(p.vel[0] * p.vel[0] + p.vel[1] * p.vel[1]));
    const metrics = {
      meanSpeed: this.mean(speeds),
      medianSpeed: this.median(speeds),
      speedStd: this.standardDeviation(speeds),
      minSpeed: speeds.length ? Math.min(...speeds) : 0,
      maxSpeed: speeds.length ? Math.max(...speeds) : 0
    };
    this.speedMetricsCache = metrics;
    this.speedMetricsCacheTime = this.time;
    return metrics;
  }

  getObstacleClearanceMetrics() {
    if (
      this.obstacleClearanceCache &&
      this.obstacleClearanceCacheTime === this.time
    ) {
      return this.obstacleClearanceCache;
    }

    if (this.swarm.length === 0 || this.obstacles.length === 0) {
      const emptyMetrics = {
        minObstacleClearance: 0,
        meanObstacleClearance: 0,
        obstacleContactFraction: 0
      };
      this.obstacleClearanceCache = emptyMetrics;
      this.obstacleClearanceCacheTime = this.time;
      return emptyMetrics;
    }

    const clearances = [];
    let contacts = 0;

    for (const p of this.swarm) {
      let nearestClearance = Infinity;

      for (const obs of this.obstacles) {
        const centerDistance = this.euclideanDist(p.pos, [obs.x, obs.y]);
        const clearance = centerDistance - obs.radius - this.conf.boidRadius;
        nearestClearance = Math.min(nearestClearance, clearance);
      }

      if (nearestClearance <= 0) contacts++;
      clearances.push(nearestClearance);
    }

    const metrics = {
      minObstacleClearance: Math.min(...clearances),
      meanObstacleClearance: this.mean(clearances),
      obstacleContactFraction: contacts / this.swarm.length
    };
    this.obstacleClearanceCache = metrics;
    this.obstacleClearanceCacheTime = this.time;
    return metrics;
  }

  getCrowdingPenalty() {
    return this.getSpatialMetrics().crowdingPenalty;
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
    const targetArrivalSuccess = this.targetArrivalSuccess();
    const targetApproachScore = this.targetApproachScore();
    const leaderTargetArrivalSuccess = this.leaderTargetArrivalSuccess();
    const leaderTargetApproachScore = this.leaderTargetApproachScore();
    const leaderFollowScore = this.leaderFollowScore();
    const bestTargetArrivalSuccess = Math.max(this.bestTargetArrivalSuccess, targetArrivalSuccess);
    const bestLeaderTargetApproachScore = Math.max(this.bestLeaderTargetApproachScore, leaderTargetApproachScore);
    const averageTargetArrivalSuccess = this.averageTargetArrivalSuccess();
    const averageLeaderTargetApproachScore = this.averageLeaderTargetApproachScore();
    const averageLeaderTargetArrivalSuccess = this.averageLeaderTargetArrivalSuccess();
    const averageLeaderFollowScore = this.averageLeaderFollowScore();
    const averageTargetChangeInterval = this.averageTargetChangeInterval();
    const targetChangeIntervalStd = this.targetChangeIntervalStd();
    const targetCompletionGoal = Math.max(1, Math.floor(this.conf.maxSteps / 250));
    const targetCompletionScore = Math.min(1, this.targetCompletionCount / targetCompletionGoal);
    const targetIntervalScore = this.targetCompletionCount > 0
      ? 1 - Math.min(1, averageTargetChangeInterval / Math.max(1, this.conf.maxSteps))
      : 0;
    const bestTargetApproachScore = Math.max(this.bestTargetApproachScore, targetApproachScore);
    const averageTargetApproachScore = this.averageTargetApproachScore();
    const spatialMetrics = this.getSpatialMetrics();
    const speedMetrics = this.getSpeedMetrics();
    const obstacleClearanceMetrics = this.getObstacleClearanceMetrics();
    const crowdingPenalty = spatialMetrics.crowdingPenalty;
    const collisionRate = this.collisionCount / Math.max(1, this.time * this.swarm.length);

    let timeScore;
    if (this.firstMajorityTime !== -1) {
      timeScore = 1.0 - this.firstMajorityTime / this.conf.maxSteps;
    } else {
      timeScore = 0.0;
    }

    const leaderNavigationScore = this.mean([
      averageLeaderTargetApproachScore,
      averageLeaderTargetArrivalSuccess
    ]);
    const flockNavigationScore = this.mean([
      averageTargetApproachScore,
      bestTargetArrivalSuccess
    ]);
    const taskCompletionScore = this.mean([
      targetCompletionScore,
      targetIntervalScore
    ]);
    const targetScore = this.mean([
      leaderNavigationScore,
      flockNavigationScore,
      taskCompletionScore
    ]);
    const navigationCost = 1 - targetScore;
    const alignmentCost = 1 - orderParam;
    const safeCollisionRate = Math.max(0, collisionRate);
    const collisionCost = Math.min(1, safeCollisionRate);
    const collisionPenalty = COLLISION_FITNESS_PENALTY_WEIGHT * collisionCost;
    const crowdingCost = Math.min(1, Math.max(0, crowdingPenalty));
    const fragmentationCost = Math.min(1, Math.max(0, spatialMetrics.fragmentationPenalty));
    const spacingScore = Math.min(1, Math.max(0, spatialMetrics.spacingScore));
    const formationScore = 1 - this.mean([
      alignmentCost,
      crowdingCost,
      fragmentationCost,
      1 - averageLeaderFollowScore
    ]);
    const constraintScore = formationScore * spacingScore;
    const fitness = Math.max(0, Math.min(1, targetScore * constraintScore - collisionPenalty));
    const cost = 1 - fitness;

    return {
      fitness: fitness,
      cost: cost,
      timeScore: timeScore,
      targetArrivalSuccess: targetArrivalSuccess,
      leaderTargetArrivalSuccess: leaderTargetArrivalSuccess,
      leaderTargetApproachScore: leaderTargetApproachScore,
      leaderFollowScore: leaderFollowScore,
      bestTargetArrivalSuccess: bestTargetArrivalSuccess,
      bestLeaderTargetApproachScore: bestLeaderTargetApproachScore,
      averageTargetArrivalSuccess: averageTargetArrivalSuccess,
      averageLeaderTargetApproachScore: averageLeaderTargetApproachScore,
      averageLeaderTargetArrivalSuccess: averageLeaderTargetArrivalSuccess,
      averageLeaderFollowScore: averageLeaderFollowScore,
      targetApproachScore: targetApproachScore,
      bestTargetApproachScore: bestTargetApproachScore,
      averageTargetApproachScore: averageTargetApproachScore,
      leaderNavigationScore: leaderNavigationScore,
      flockNavigationScore: flockNavigationScore,
      taskCompletionScore: taskCompletionScore,
      targetCompletionScore: targetCompletionScore,
      targetIntervalScore: targetIntervalScore,
      targetScore: targetScore,
      formationScore: formationScore,
      spacingScore: spacingScore,
      constraintScore: constraintScore,
      crowdingPenalty: crowdingPenalty,
      navigationCost: navigationCost,
      alignmentCost: alignmentCost,
      collisionCost: collisionCost,
      collisionPenalty: collisionPenalty,
      crowdingCost: crowdingCost,
      fragmentationCost: fragmentationCost,
      collisionRate: collisionRate,
      orderParameter: orderParam,
      meanNearestNeighborDistance: spatialMetrics.meanNearestNeighborDistance,
      medianNearestNeighborDistance: spatialMetrics.medianNearestNeighborDistance,
      minNearestNeighborDistance: spatialMetrics.minNearestNeighborDistance,
      flockComponents: spatialMetrics.flockComponents,
      largestClusterFraction: spatialMetrics.largestClusterFraction,
      fragmentationPenalty: spatialMetrics.fragmentationPenalty,
      meanSpeed: speedMetrics.meanSpeed,
      medianSpeed: speedMetrics.medianSpeed,
      speedStd: speedMetrics.speedStd,
      minSpeed: speedMetrics.minSpeed,
      maxSpeed: speedMetrics.maxSpeed,
      minObstacleClearance: obstacleClearanceMetrics.minObstacleClearance,
      meanObstacleClearance: obstacleClearanceMetrics.meanObstacleClearance,
      obstacleContactFraction: obstacleClearanceMetrics.obstacleContactFraction,
      collisions: this.collisionCount,
      firstMajorityTime: this.firstMajorityTime,
      targetCompletionCount: this.targetCompletionCount,
      lastTargetCompletionTime: this.lastTargetCompletionTime,
      lastTargetChangeInterval: this.lastTargetChangeInterval,
      averageTargetChangeInterval: averageTargetChangeInterval,
      targetChangeIntervalStd: targetChangeIntervalStd
    };
  }

  computeOptimizationFitness() {
    const base = this.computeFitness();

    return {
      fitness: base.fitness,
      cost: base.cost,
      orderParam: base.orderParameter,
      timeScore: base.timeScore,
      targetArrivalSuccess: base.targetArrivalSuccess,
      leaderTargetArrivalSuccess: base.leaderTargetArrivalSuccess,
      leaderTargetApproachScore: base.leaderTargetApproachScore,
      leaderFollowScore: base.leaderFollowScore,
      bestTargetArrivalSuccess: base.bestTargetArrivalSuccess,
      bestLeaderTargetApproachScore: base.bestLeaderTargetApproachScore,
      averageTargetArrivalSuccess: base.averageTargetArrivalSuccess,
      averageLeaderTargetApproachScore: base.averageLeaderTargetApproachScore,
      averageLeaderTargetArrivalSuccess: base.averageLeaderTargetArrivalSuccess,
      averageLeaderFollowScore: base.averageLeaderFollowScore,
      targetApproachScore: base.targetApproachScore,
      bestTargetApproachScore: base.bestTargetApproachScore,
      averageTargetApproachScore: base.averageTargetApproachScore,
      leaderNavigationScore: base.leaderNavigationScore,
      flockNavigationScore: base.flockNavigationScore,
      taskCompletionScore: base.taskCompletionScore,
      targetCompletionScore: base.targetCompletionScore,
      targetIntervalScore: base.targetIntervalScore,
      targetScore: base.targetScore,
      formationScore: base.formationScore,
      spacingScore: base.spacingScore,
      constraintScore: base.constraintScore,
      navigationCost: base.navigationCost,
      alignmentCost: base.alignmentCost,
      collisionCost: base.collisionCost,
      collisionPenalty: base.collisionPenalty,
      crowdingCost: base.crowdingCost,
      fragmentationCost: base.fragmentationCost,
      crowdingPenalty: base.crowdingPenalty,
      collisionRate: base.collisionRate,
      meanNearestNeighborDistance: base.meanNearestNeighborDistance,
      medianNearestNeighborDistance: base.medianNearestNeighborDistance,
      minNearestNeighborDistance: base.minNearestNeighborDistance,
      flockComponents: base.flockComponents,
      largestClusterFraction: base.largestClusterFraction,
      fragmentationPenalty: base.fragmentationPenalty,
      meanSpeed: base.meanSpeed,
      speedStd: base.speedStd,
      minObstacleClearance: base.minObstacleClearance,
      meanObstacleClearance: base.meanObstacleClearance,
      obstacleContactFraction: base.obstacleContactFraction,
      targetCompletionCount: base.targetCompletionCount,
      lastTargetCompletionTime: base.lastTargetCompletionTime,
      lastTargetChangeInterval: base.lastTargetChangeInterval,
      averageTargetChangeInterval: base.averageTargetChangeInterval,
      targetChangeIntervalStd: base.targetChangeIntervalStd,
      weights: this.getBehaviourWeightVector()
    };
  }

  getBehaviourWeightVector() {
    const c = this.conf;
    return [
      c.cohesion,
      c.alignment,
      c.separation,
      c.targetWeight,
      c.avoidance,
      c.leaderFollowWeight,
      c.randomWeight
    ];
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

      if (this.euclideanDist(pos, [this.conf.targetX, this.conf.targetY]) < this.targetArrivalRadius() + this.conf.boidRadius) {
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

    const currentArrivalSuccess = this.targetArrivalSuccess();
    const currentApproach = this.targetApproachScore();
    const currentLeaderApproach = this.leaderTargetApproachScore();
    const currentLeaderArrival = this.leaderTargetArrivalSuccess();
    const currentLeaderFollow = this.leaderFollowScore();
    this.bestTargetArrivalSuccess = Math.max(this.bestTargetArrivalSuccess, currentArrivalSuccess);
    this.targetArrivalSuccessAccumulator += currentArrivalSuccess;
    this.bestTargetApproachScore = Math.max(this.bestTargetApproachScore, currentApproach);
    this.targetApproachAccumulator += currentApproach;
    this.bestLeaderTargetApproachScore = Math.max(this.bestLeaderTargetApproachScore, currentLeaderApproach);
    this.leaderTargetApproachAccumulator += currentLeaderApproach;
    this.leaderTargetArrivalAccumulator += currentLeaderArrival;
    this.leaderFollowAccumulator += currentLeaderFollow;
    this.targetTrackingSteps++;

    if (currentArrivalSuccess >= this.conf.majorityThreshold) {
      if (this.firstMajorityTime === -1) {
        this.firstMajorityTime = this.time;
      }

      if (this.conf.autoRetargetOnMajority) {
        this.completeCurrentTarget(currentArrivalSuccess);
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
    const visibleBoids = Math.max(0, Math.round(this.S.conf.targetVisibleBoids || 0));
    if (this.id >= visibleBoids) {
      return [0, 0];
    }

    const dx = this.S.conf.targetX - this.pos[0];
    const dy = this.S.conf.targetY - this.pos[1];
    const d = Math.sqrt(dx * dx + dy * dy);

    if (d < 1e-8) {
      return [0, 0];
    }

    const targetDir = this.normalizeVector([dx, dy]);
    const targetStrength = Math.min(
      d / TARGET_STRENGTH_DISTANCE,
      1
    );

    return this.multiplyVector(targetDir, targetStrength);
  }

  leaderFollowVector() {
    if (this.id < this.S.leaderCount()) {
      return [0, 0];
    }

    const nearest = this.S.nearestLeader(this);
    if (!nearest.leader || !Number.isFinite(nearest.distance)) {
      return [0, 0];
    }

    const leaderPos = this.S.wrap(nearest.leader.pos, this.pos);
    const toLeader = [
      leaderPos[0] - this.pos[0],
      leaderPos[1] - this.pos[1]
    ];
    const distance = this.magnitude(toLeader);

    if (distance < 1e-8) {
      return [0, 0];
    }

    const preferred = Math.max(1, this.S.conf.leaderPreferredDistance || this.S.conf.interactionRadius);
    const influence = Math.max(
      preferred + 1,
      this.S.conf.leaderInfluenceRadius || this.S.conf.interactionRadius * 4
    );
    const strength = Math.min(
      1,
      Math.max(0, distance - preferred) / (influence - preferred)
    );
    const followComponent = this.multiplyVector(this.normalizeVector(toLeader), strength);
    const alignmentStrength = 1 - Math.min(1, distance / influence);
    const alignmentComponent = this.multiplyVector(
      this.limitMagnitude([
        nearest.leader.vel[0] - this.vel[0],
        nearest.leader.vel[1] - this.vel[1]
      ], 1),
      alignmentStrength
    );

    return this.multiplyVector(this.limitMagnitude(
      this.addVectors(followComponent, alignmentComponent),
      1
    ), this.localSpacingScale());
  }

  localSpacingScale() {
    const neighbors = this.S.neighbours(this, this.S.conf.separationRadius, false);
    if (neighbors.length === 0) return 1;

    let nearest = Infinity;
    for (const n of neighbors) {
      nearest = Math.min(nearest, this.S.dist(this.pos, n.pos));
    }

    const minSpacing = this.S.conf.boidRadius * 2;
    const desiredSpacing = Math.max(minSpacing + 1, this.S.conf.separationRadius);
    return Math.min(
      1,
      Math.max(0, (nearest - minSpacing) / (desiredSpacing - minSpacing))
    );
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
    const L = this.leaderFollowVector();
    const O = this.obstacleAvoidanceVector();
    const R = this.randomVector();

    let V = [0, 0];
    const obstacleResponse = this.magnitude(O) > 1e-6;

    V = this.addVectors(V, this.multiplyVector(C, c.cohesion));
    V = this.addVectors(V, this.multiplyVector(A, c.alignment));
    V = this.addVectors(V, this.multiplyVector(S, c.separation));
    V = this.addVectors(V, this.multiplyVector(T, this.S.effectiveTargetWeight()));
    V = this.addVectors(V, this.multiplyVector(L, c.leaderFollowWeight || 0));
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
