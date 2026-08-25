export interface SillageBounds {
  left: number
  right: number
  top: number
  bottom: number
}

export interface SillageTrailPoint {
  x: number
  t: number
}

export interface SillageSample {
  centerX: number
  width: number
  leftWall: number
  rightWall: number
}

export interface SillageState {
  readonly seed: number
  readonly difficulty: number
  readonly duration: number
  readonly radius: number
  readonly bounds: SillageBounds
  readonly playerY: number
  readonly forwardSpeed: number
  readonly totalDistance: number
  readonly viewDistance: number
  readonly phaseA: number
  readonly phaseB: number
  readonly phaseC: number
  readonly phaseW: number
  elapsed: number
  distance: number
  progress: number
  centerX: number
  width: number
  leftWall: number
  rightWall: number
  playerX: number
  playerVx: number
  stability: number
  readonly stabilityMax: number
  clearance: number
  near: number
  touching: boolean
  wallSide: -1 | 0 | 1
  contactT: number
  centerQuality: number
  centerScore: number
  clean: boolean
  lastScrapeAt: number
  trail: SillageTrailPoint[]
}

export interface SillageStepResult {
  contactStarted: boolean
  contactEnded: boolean
  scrape: boolean
  completed: boolean
  failed: boolean
}

const TAU = Math.PI * 2
const TRAIL_LIFE = 4.2
const WALL_MARGIN = 12
const MIN_WIDTH_BALLS = 1.5
const MAX_WIDTH_BALLS = 5.5
const HAPTIC_DISTANCE_BALLS = 3.5

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function seedUnit(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

function centerNorm(s: SillageState, u: number): number {
  const d = s.difficulty
  const a = 1.05 + d * 0.55
  const b = 2.5 + d * 0.95
  const c = 5.1 + d * 1.25
  const noise =
    Math.sin(TAU * a * u + s.phaseA) * 0.62 +
    Math.sin(TAU * b * u + s.phaseB) * 0.27 +
    Math.sin(TAU * c * u + s.phaseC) * 0.11
  return clamp(0.5 + (0.15 + d * 0.11) * noise, 0.2, 0.8)
}

function widthBalls(s: SillageState, u: number): number {
  const d = s.difficulty
  const base = 4.5 - d * 1.8
  const wobble =
    Math.sin(TAU * (0.82 + d * 0.3) * u + s.phaseW) * (0.85 + d * 0.35) +
    Math.sin(TAU * (2.7 + d * 0.65) * u + s.phaseA * 0.7) * 0.35
  return clamp(base + wobble, MIN_WIDTH_BALLS, MAX_WIDTH_BALLS)
}

export function sampleSillageAt(s: SillageState, progress: number): SillageSample {
  const distance = clamp(progress, 0, 1) * s.totalDistance
  const spatialU = distance / Math.max(1, s.viewDistance)
  const span = Math.max(1, s.bounds.right - s.bounds.left)
  const width = clamp(
    s.radius * 2 * widthBalls(s, spatialU),
    s.radius * 2 * MIN_WIDTH_BALLS,
    Math.min(s.radius * 2 * MAX_WIDTH_BALLS, span - WALL_MARGIN * 2),
  )
  const rawCenter = s.bounds.left + span * centerNorm(s, spatialU)
  const centerX = clamp(
    rawCenter,
    s.bounds.left + width / 2 + WALL_MARGIN,
    s.bounds.right - width / 2 - WALL_MARGIN,
  )
  return {
    centerX,
    width,
    leftWall: centerX - width / 2,
    rightWall: centerX + width / 2,
  }
}

export function createSillage(options: {
  seed: number
  difficulty: number
  duration: number
  radius: number
  forwardSpeed: number
  bounds: SillageBounds
}): SillageState {
  const difficulty = clamp(options.difficulty, 0, 1)
  const bounds = { ...options.bounds }
  const duration = Math.max(6, options.duration)
  const forwardSpeed = Math.max(1, options.forwardSpeed)
  const playerY = bounds.top + (bounds.bottom - bounds.top) * 0.72
  const state: SillageState = {
    seed: options.seed >>> 0,
    difficulty,
    duration,
    radius: Math.max(8, options.radius),
    bounds,
    playerY,
    forwardSpeed,
    totalDistance: forwardSpeed * duration,
    viewDistance: Math.max(1, (bounds.bottom - bounds.top) * 1.15),
    phaseA: seedUnit(options.seed, 1) * TAU,
    phaseB: seedUnit(options.seed, 2) * TAU,
    phaseC: seedUnit(options.seed, 3) * TAU,
    phaseW: seedUnit(options.seed, 4) * TAU,
    elapsed: 0,
    distance: 0,
    progress: 0,
    centerX: 0,
    width: 0,
    leftWall: 0,
    rightWall: 0,
    playerX: 0,
    playerVx: 0,
    stability: 100,
    stabilityMax: 100,
    clearance: 0,
    near: 0,
    touching: false,
    wallSide: 0,
    contactT: 0,
    centerQuality: 1,
    centerScore: 0,
    clean: true,
    lastScrapeAt: -1,
    trail: [],
  }
  const initial = sampleSillageAt(state, 0)
  state.centerX = initial.centerX
  state.width = initial.width
  state.leftWall = initial.leftWall
  state.rightWall = initial.rightWall
  state.playerX = initial.centerX
  state.clearance = initial.width / 2 - state.radius
  state.trail.push({ x: state.playerX, t: 0 })
  return state
}

export function stepSillage(
  state: SillageState,
  dt: number,
  axis: number,
  targetX: number | null,
): SillageStepResult {
  const d = Math.max(0, dt)
  const wasTouching = state.touching
  state.elapsed = Math.min(state.duration, state.elapsed + d)
  state.distance = state.elapsed * state.forwardSpeed
  state.progress = clamp(state.distance / state.totalDistance, 0, 1)

  const maxSpeed = 420 + state.difficulty * 95
  if (targetX !== null && Number.isFinite(targetX)) {
    const target = clamp(
      targetX,
      state.bounds.left + state.radius,
      state.bounds.right - state.radius,
    )
    const desired = clamp((target - state.playerX) * 11, -maxSpeed, maxSpeed)
    state.playerVx += (desired - state.playerVx) * Math.min(1, d * 13)
  } else {
    state.playerVx += clamp(axis, -1, 1) * (2480 + state.difficulty * 720) * d
    state.playerVx *= Math.exp(-(3.15 - state.difficulty * 0.35) * d)
  }
  state.playerVx = clamp(state.playerVx, -maxSpeed, maxSpeed)
  state.playerX += state.playerVx * d
  state.playerX = clamp(
    state.playerX,
    state.bounds.left + state.radius,
    state.bounds.right - state.radius,
  )

  const sample = sampleSillageAt(state, state.progress)
  state.centerX = sample.centerX
  state.width = sample.width
  state.leftWall = sample.leftWall
  state.rightWall = sample.rightWall

  const leftClearance = state.playerX - state.radius - state.leftWall
  const rightClearance = state.rightWall - state.radius - state.playerX
  const rawClearance = Math.min(leftClearance, rightClearance)
  const touching = rawClearance <= 0.5
  if (state.playerX < state.leftWall + state.radius) {
    state.playerX = state.leftWall + state.radius
    if (state.playerVx < 0) state.playerVx *= 0.12
  } else if (state.playerX > state.rightWall - state.radius) {
    state.playerX = state.rightWall - state.radius
    if (state.playerVx > 0) state.playerVx *= 0.12
  }
  state.clearance = rawClearance
  const hapticDistance = Math.max(
    state.radius * 0.8,
    Math.min(state.radius * HAPTIC_DISTANCE_BALLS, state.width * 0.45),
  )
  state.near = clamp(1 - Math.max(0, rawClearance) / hapticDistance, 0, 1)
  state.wallSide =
    state.near > 0 ? (leftClearance <= rightClearance ? -1 : 1) : 0
  state.touching = touching
  const centerReach = Math.max(1, state.width / 2 - state.radius)
  state.centerQuality = clamp(
    1 - Math.abs(state.playerX - state.centerX) / centerReach,
    0,
    1,
  )
  state.centerScore += state.centerQuality * d

  if (touching) {
    state.contactT += d
    const pressure = 1 + Math.min(1.2, state.contactT * 0.7)
    state.stability = Math.max(
      0,
      state.stability - (24 + state.difficulty * 30) * pressure * d,
    )
    state.clean = false
  } else {
    state.contactT = 0
    state.stability = Math.min(
      state.stabilityMax,
      state.stability + (7 + (1 - state.difficulty) * 4) * d,
    )
  }

  const lastTrail = state.trail[state.trail.length - 1]
  if (!lastTrail || state.elapsed - lastTrail.t > 0.035 || Math.abs(lastTrail.x - state.playerX) > 1) {
    state.trail.push({ x: state.playerX, t: state.elapsed })
  }
  while (state.trail.length > 0 && state.elapsed - state.trail[0].t > TRAIL_LIFE) {
    state.trail.shift()
  }
  if (state.trail.length > 260) state.trail.splice(0, state.trail.length - 260)

  const scrape =
    touching &&
    (!wasTouching || state.elapsed - state.lastScrapeAt >= 0.22)
  if (scrape) state.lastScrapeAt = state.elapsed

  return {
    contactStarted: touching && !wasTouching,
    contactEnded: !touching && wasTouching,
    scrape,
    completed: state.progress >= 1,
    failed: state.stability <= 0,
  }
}
