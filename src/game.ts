import {
  generateMaze,
  hashSeed,
  rngFromSeed,
  wallsAtPoint,
  wallsNear,
  type Maze,
  type Rng,
} from './maze'
import type { Input } from './input'
import type { SoundEngine } from './audio'

export const BOARD = 960
const MARGIN = 34
const REVEAL_LIFE_BASE = 3.6

export type Phase = 'ready' | 'preview' | 'playing' | 'transition' | 'recap' | 'paused'

export const RUN_LENGTH = 5
const CELL_PTS = 15
const COMBO_STEP = 4
const MULT_MAX = 5
const COMBO_STALL = 5
const IMPACT_UNKNOWN_COST = 40
const IMPACT_KNOWN_COST = 80
const CARTO_PTS = 4
const PAR_SECONDS_PER_CELL = 0.62
const PAR_SLACK = 1.2
const TIME_RATIO_WEIGHT = 0.35
const BASE_PER_CELL = 10
const RANKS = [
  { k: 33, name: 'PLATINE', cls: 'platine' },
  { k: 25, name: 'OR', cls: 'or' },
  { k: 17, name: 'ARGENT', cls: 'argent' },
  { k: 11, name: 'BRONZE', cls: 'bronze' },
] as const

export interface LevelResult {
  size: number
  time: number
  impacts: number
  impactsKnown: number
  probed: number
  flashes: number
  rank: string
  points: number
}

export interface RunEntry {
  score: number
  time: number
  date: string
}

export interface LevelSummary {  time: number
  pathPts: number
  timePts: number
  cartoPts: number
  impactPen: number
  impacts: number
  impactsKnown: number
  probed: number
  flashes: number
  points: number
  rankName: string
  rankCls: string
  maxSpeedU: number
  maxChain: number
  distCells: number
}

export interface Popup {
  x: number
  y: number
  text: string
  color: string
  size: number
  t: number
}

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  t: number
  life: number
  color: string
  size: number
}

export interface Mode {
  id: string
  name: string
  desc: string
  mult: number
  revealLifeMul: number
  trailFadeMul: number
  impactCostMul: number
  grenadesPerLevel: number
  preReveal: number
  daily?: boolean
}

export const MODES: Mode[] = [
  {
    id: 'decouverte',
    name: 'DÉCOUVERTE',
    desc: 'Murs longtemps visibles · trainée persistante · impacts adoucis · 25% pré-révélé · ⚡5/niveau',
    mult: 0.6,
    revealLifeMul: 2.5,
    trailFadeMul: 0.45,
    impactCostMul: 0.5,
    grenadesPerLevel: 5,
    preReveal: 0.25,
  },
  {
    id: 'classique',
    name: 'CLASSIQUE',
    desc: "L'expérience Koh-Lanta telle qu'elle a été pensée · ⚡3/niveau · 1er choc sur mur palpé pardonné",
    mult: 1,
    revealLifeMul: 1,
    trailFadeMul: 1,
    impactCostMul: 1,
    grenadesPerLevel: 3,
    preReveal: 0,
  },
  {
    id: 'eclair',
    name: 'ÉCLAIR',
    desc: 'Révélations brèves, trainée fugace, impacts plus chers · ⚡2/niveau',
    mult: 1.4,
    revealLifeMul: 0.55,
    trailFadeMul: 1.8,
    impactCostMul: 1.25,
    grenadesPerLevel: 2,
    preReveal: 0,
  },
  {
    id: 'aveugle',
    name: 'AVEUGLE',
    desc: 'La vraie nuit de Koh-Lanta · ⚡1/niveau',
    mult: 2,
    revealLifeMul: 0.35,
    trailFadeMul: 3,
    impactCostMul: 1.5,
    grenadesPerLevel: 1,
    preReveal: 0,
  },
  {
    id: 'jour',
    name: 'DÉFI DU JOUR',
    desc: 'Les 5 grilles du jour, identiques pour tous · boucles garanties · ⚡3/niveau',
    mult: 1.5,
    revealLifeMul: 1,
    trailFadeMul: 1,
    impactCostMul: 1,
    grenadesPerLevel: 3,
    preReveal: 0,
    daily: true,
  },
]

const FLASH_PAID_BASE = 100
const FLASH_PAID_STEP = 100
const FLASH_RADIUS_CELLS = 3.2

export const SONAR_DUR = 0.9
export const SONAR_RANGE_CELLS = 7
const SONAR_GRAZE_NEED = 5
const SONAR_MAX = 3
const ZONE_NOIR_K = 900

export type Modifier = 'rush' | 'silence'

export interface Zone {
  kind: 'courant' | 'noir'
  x: number
  y: number
  w: number
  h: number
  dx: number
  dy: number
  cx: number
  cy: number
}

export interface Hazard {
  kind: 'orb' | 'bar'
  x: number
  y: number
  vx: number
  vy: number
  r: number
  w: number
  h: number
}

export interface Arena {
  kind: 'chargeur' | 'tisseur'
  hp: number
  shields: number
  invulnT: number
  t: number
  nextAttackAt: number
  patternIdx: number
  pending: { at: number; make: () => Hazard }[]
  haz: Hazard[]
  windup: number
  lungeUntil: number
  ldx: number
  ldy: number
  nextDashAt: number
  windupDur: number
  dashCombo: number
  bounces: number
  shocks: { t0: number; done: boolean }[]
  spikes: { x: number; y: number; w: number; h: number }[]
  stunUntil: number
  bx: number
  by: number
  bvx: number
  bvy: number
  br: number
  flash: number
  Ax: number
  Ay: number
  Aw: number
  Ah: number
}

export function fmtTime(t: number): string {
  const mm = Math.floor(t / 60)
  const ss = Math.floor(t % 60)
  const cs = Math.floor((t % 1) * 100)
  return `${mm}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function levelSize(n: number): number {
  return Math.min(8 + n * 2, 22)
}

export class Game {
  phase: Phase = 'ready'
  level = 0
  gridSize = 8
  maze: Maze
  clock = 0
  totalTime = 0
  levelTime = 0
  ball = { x: BOARD / 2, y: BOARD / 2, vx: 0, vy: 0, r: 10 }
  probe = { x: 0, y: 0, active: false, touching: false }
  trailX = BOARD / 2
  trailY = BOARD / 2
  trailEpoch = 0
  reveals = new Map<number, { t: number; s: number; m: 'probe' | 'hit'; w?: number }>()
  squash = { a: 0, v: 0, ang: 0 }
  messageTitle = 'LABYRINTHE AVEUGLE'
  messageSub =
    'Stick gauche : rouler · Stick droit : palper les murs\nRB / G : éclair · Start : pause · F : plein écran'
  zones: Zone[] = []
  portalCell: [number, number] | null = null
  portalConsumed = false
  portalKind: 'chargeur' | 'tisseur' = 'chargeur'
  portalCooldownUntil = -1
  arena: Arena | null = null

  todayLabel(): string {
    const [y, m, d] = this.todayKey().split('-')
    return `${d}/${m}/${y}`
  }
  titleCls = ''
  runResults: LevelResult[] = []
  totalScore = 0
  levelPoints = 0
  mult = 1
  popups: Popup[] = []
  particles: Particle[] = []
  shake = 0
  modeIndex = 1
  grenades = 0
  flashAt = -10
  modifier: Modifier | null = null
  sonarCharges = 1
  sonarFill = 0
  private grazeAt = new Map<number, number>()
  private sonarT0 = -1
  private sonarPrevR = 0
  private bossTurnAt = 0
  private savedPos = { x: BOARD / 2, y: BOARD / 2 }
  previewT = 0
  previewDur = 2

  private transitionT = 0
  private lastHit = -1
  private lastBuzz = -1
  private wasTouching = false
  private candidates = new Set<number>()
  private probeHits: number[] = []
  private levelImpacts = 0
  private levelImpactsKnown = 0
  private levelProbed = new Set<number>()
  private probedForgiven = new Set<number>()
  private knownWalls = new Set<number>()
  private impactAt = new Map<number, number>()
  private lastImpactAny = -1
  private chain = 0
  private comboT = 0
  private visited = new Set<number>()
  private lastCellKey = -1
  private levelImpactPen = 0
  private flashPaidUsed = 0
  private levelFlashes = 0
  private levelFlashSpent = 0
  private runFlashSpent = 0
  private levelMaxSp = 0
  private levelDist = 0
  private levelMaxChain = 0
  lastSummary: LevelSummary | null = null
  previewPts: [number, number][] = []
  private drainT = -1
  private drainDur = 1.5
  private speedNorm = 0
  private exitGlow = 0

  get motion(): number {
    return this.speedNorm
  }

  constructor(
    private input: Input,
    private audio: SoundEngine,
  ) {
    this.maze = this.makeLevel(0)
    this.resetBall()
  }

  private makeLevel(n: number): Maze {
    const size = levelSize(n)
    this.gridSize = size
    const cell = Math.floor((BOARD - MARGIN * 2) / size)
    const span = cell * size
    const off = (BOARD - span) / 2
    this.ball.r = Math.max(6, cell * 0.23)
    const mz = generateMaze(
      size,
      size,
      off,
      off,
      cell,
      Math.max(5, Math.round(cell * 0.09)),
      this.rngFor(n),
      this.braidFor(n),
    )
    this.maze = mz
    if (this.mode.preReveal > 0) {
      const count = Math.floor(mz.walls.length * this.mode.preReveal)
      for (let i = 0; i < count; i++) {
        const id = Math.floor(Math.random() * mz.walls.length)
        this.softReveal(id, 0.5, 'probe')
      }
    }
    this.previewDur = Math.min(3, Math.max(1.8, mz.path.length * 0.045))
    this.drainDur = Math.min(3, Math.max(1.2, this.previewDur * 0.75))
    this.rollModifier(n)
    this.rollZones(n)
    this.rollPortal(n)
    this.previewPts = mz.path.map((c) => this.cellCenter(c))
    this.visited.clear()
    const [sx, sy] = mz.start
    this.lastCellKey = sy * size + sx
    this.visited.add(this.lastCellKey)
    return mz
  }

  private todayKey(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
  }

  private rngFor(n: number): Rng {
    return this.mode.daily ? rngFromSeed(hashSeed(`${this.todayKey()}#${n}`)) : Math.random
  }

  private braidFor(n: number): number {
    return this.mode.daily ? 0.2 : Math.min(0.22, n * 0.06)
  }

  private rollModifier(n: number): void {
    this.modifier = null
    if (n < 1) return
    const rnd = this.mode.daily
      ? rngFromSeed(hashSeed(`${this.todayKey()}|mod|${n}`))
      : Math.random
    if (rnd() >= 0.65) return
    this.modifier = (['rush', 'silence'] as const)[Math.floor(rnd() * 2)]
  }

  private rollZones(n: number): void {
    this.zones = []
    if (n < 1) return
    const rnd = this.mode.daily
      ? rngFromSeed(hashSeed(`${this.todayKey()}|zones|${n}`))
      : Math.random
    if (rnd() >= 0.6) return
    const count = rnd() < 0.4 ? 2 : 1
    const size = Math.min(8 + n * 2, 22)
    const m = this.maze
    for (let i = 0; i < count; i++) {
      const cw = 3 + Math.floor(rnd() * 3)
      const ch = 3 + Math.floor(rnd() * 2)
      const ccx = 1 + Math.floor(rnd() * (size - cw - 2))
      const ccy = 1 + Math.floor(rnd() * (size - ch - 2))
      if (
        Math.abs(ccx - m.start[0]) <= 2 ||
        Math.abs(ccx - m.exit[0]) <= 2 ||
        Math.abs(ccy - m.start[1]) <= 2 ||
        Math.abs(ccy - m.exit[1]) <= 2
      ) {
        continue
      }
      const kind: 'courant' | 'noir' = rnd() < 0.5 ? 'courant' : 'noir'
      let dx = 0
      let dy = 0
      if (kind === 'courant') {
        const a = Math.floor(rnd() * 4)
        const mag = 430 + rnd() * 190
        dx = [1, 0, -1, 0][a] * mag
        dy = [0, 1, 0, -1][a] * mag
      }
      this.zones.push({
        kind,
        x: m.ox + ccx * m.cell + m.cell * 0.15,
        y: m.oy + ccy * m.cell + m.cell * 0.15,
        w: cw * m.cell - m.cell * 0.3,
        h: ch * m.cell - m.cell * 0.3,
        dx,
        dy,
        cx: m.ox + (ccx + cw / 2) * m.cell,
        cy: m.oy + (ccy + ch / 2) * m.cell,
      })
    }
  }

  private rollPortal(n: number): void {
    this.portalCell = null
    this.portalConsumed = false
    if (n < 1 || this.maze.path.length < 6) return
    const rnd = this.mode.daily
      ? rngFromSeed(hashSeed(`${this.todayKey()}|portal|${n}`))
      : Math.random
    const lo = Math.floor(this.maze.path.length * 0.35)
    const hi = Math.floor(this.maze.path.length * 0.78)
    const order: number[] = []
    for (let i = lo; i < hi; i++) order.push(i)
    while (order.length > 0) {
      const pick = Math.floor(rnd() * order.length)
      const idx = order.splice(pick, 1)[0]
      const [cx, cy] = this.maze.path[idx]
      const px = this.maze.ox + (cx + 0.5) * this.maze.cell
      const py = this.maze.oy + (cy + 0.5) * this.maze.cell
      const inZone = this.zones.some(
        (z) =>
          px > z.x - this.maze.cell &&
          px < z.x + z.w + this.maze.cell &&
          py > z.y - this.maze.cell &&
          py < z.y + z.h + this.maze.cell,
      )
      if (inZone) continue
      this.portalCell = [cx, cy]
      this.portalKind = rnd() < 0.5 ? 'chargeur' : 'tisseur'
      return
    }
  }

  modifierLabel(): string {
    return this.modifier === null ? '' : this.modifier.toUpperCase()
  }

  modifierTag(): string {
    return this.modifierLabel()
  }

  private stallNow(): number {
    return COMBO_STALL * (this.modifier === 'rush' ? 0.7 : 1)
  }

  sonarProgress(): number | null {
    if (this.sonarT0 < 0) return null
    const q = (this.clock - this.sonarT0) / SONAR_DUR
    return q >= 1 ? null : q
  }

  private resetBall(): void {
    const [cx, cy] = this.maze.start
    this.ball.x = this.maze.ox + (cx + 0.5) * this.maze.cell
    this.ball.y = this.maze.oy + (cy + 0.5) * this.maze.cell
    this.ball.vx = 0
    this.ball.vy = 0
    this.trailX = this.ball.x
    this.trailY = this.ball.y
  }

  get mode(): Mode {
    return MODES[this.modeIndex]
  }

  get inArena(): boolean {
    return this.arena !== null
  }

  get revealLife(): number {
    return REVEAL_LIFE_BASE * this.mode.revealLifeMul
  }

  cellCenter(c: [number, number]): [number, number] {
    return [
      this.maze.ox + (c[0] + 0.5) * this.maze.cell,
      this.maze.oy + (c[1] + 0.5) * this.maze.cell,
    ]
  }

  recordRun(modeId: string): number | null {
    try {
      const v = localStorage.getItem(`labyrinthe-record-${modeId}`)
      return v === null ? null : Number(v)
    } catch {
      return null
    }
  }

  private saveRecordRun(score: number): boolean {
    try {
      const prev = this.recordRun(this.mode.id)
      if (prev === null || score > prev) {
        localStorage.setItem(`labyrinthe-record-${this.mode.id}`, String(score))
        return true
      }
    } catch {}
    return false
  }

  update(dt: number): void {
    if (this.input.pauseEdge()) {
      if (this.phase === 'playing' || this.phase === 'preview') this.enterPause()
      else if (this.phase === 'paused') this.exitPause()
    }
    if (this.input.resetEdge()) this.resetLevel()
    if (this.phase === 'paused') {
      if (this.input.startEdge()) this.exitPause()
      return
    }
    this.clock += dt
    const q = this.squash
    q.v += (-180 * q.a - 12 * q.v) * dt
    q.a = Math.max(-0.5, Math.min(0.5, q.a + q.v * dt))
    if (this.phase === 'ready') {
      const dir = this.input.menuDir()
      if (dir !== 0) {
        this.modeIndex = (this.modeIndex + dir + MODES.length) % MODES.length
        this.maze = this.makeLevel(this.level)
        this.resetBall()
        this.audio.unlock()
      }
      if (this.input.startEdge()) {
        this.startPreview()
        this.audio.begin()
      }
    } else if (this.phase === 'preview') {
      this.previewT += dt
      if (this.input.startEdge()) {
        this.drainT = 0
        this.phase = 'playing'
        this.announceModifier()
      }
    } else if (this.phase === 'transition') {
      this.transitionT -= dt
      if (this.transitionT <= 0 && this.input.startEdge()) {
        if (this.level + 1 >= RUN_LENGTH) this.showRecap()
        else this.nextLevel()
      }
    } else if (this.phase === 'recap') {
      if (this.input.startEdge()) this.resetRun()
    } else {
      if (this.resumeCountdown > 0) {
        const prev = this.resumeCountdown
        this.resumeCountdown = Math.max(0, this.resumeCountdown - dt)
        if (this.resumeCountdown > 0 && Math.ceil(prev) !== Math.ceil(this.resumeCountdown)) {
          this.audio.tick()
        }
        if (prev > 0 && this.resumeCountdown === 0) {
          this.popup(this.ball.x, this.ball.y - this.ball.r - 46, 'GO', '#67e8f9', 1.5)
          this.audio.ping()
        }
        return
      }
      if (this.drainT >= 0) this.drainT += dt
      this.totalTime += dt
      this.levelTime += dt
      if (this.chain > 0) {
        this.comboT -= dt
        if (this.comboT <= 0) {
          this.chain = 0
          this.mult = 1
        }
      }
      if (this.arena) {
        this.arenaStep(dt)
      } else {
        this.physics(dt)
        if (this.input.flashEdge()) this.useFlash()
        if (this.input.sonarEdge()) this.fireSonar()
        this.portalCheck()
      }
      if (this.sonarT0 >= 0 && !this.arena) {
        const t = this.clock - this.sonarT0
        if (t > SONAR_DUR) this.sonarT0 = -1
        else {
          const rangePx = this.maze.cell * SONAR_RANGE_CELLS
          const r1 = (t / SONAR_DUR) * rangePx
          this.revealBand(this.sonarPrevR, r1, rangePx)
          this.sonarPrevR = r1
        }
      }
      const [ex, ey] = this.cellCenter(this.maze.exit)
      this.exitGlow = Math.max(
        0,
        1 - Math.hypot(this.ball.x - ex, this.ball.y - ey) / (this.maze.cell * 2.6),
      )
      if (!this.arena && this.atExit()) this.complete()
    }
    for (const [id, rev] of this.reveals) {
      if (rev.w !== undefined && rev.w > 0) rev.w = Math.max(0, rev.w - dt * 2.2)
      if (this.clock - rev.t > this.revealLife) this.reveals.delete(id)
    }
    if (this.popups.length > 0) {
      this.popups = this.popups.filter((p) => this.clock - p.t < 1)
    }
    this.shake *= Math.exp(-7 * dt)
    if (this.shake < 0.01) this.shake = 0
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.t += dt
      if (p.t >= p.life) {
        this.particles.splice(i, 1)
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      const f = Math.exp(-5 * dt)
      p.vx *= f
      p.vy *= f
    }
    this.syncAudio()
  }

  private syncAudio(): void {
    const playing = this.phase === 'playing'
    this.audio.setRoll(playing ? this.speedNorm : 0)
    this.audio.setProbe(playing && this.wasTouching)
    this.audio.setCombo(playing ? (this.mult - 1) / (MULT_MAX - 1) : 0)
    this.audio.setNear(playing ? this.exitGlow : 0)
  }

  private spawnBurst(px: number, py: number, nx: number, ny: number, s: number): void {
    const n = Math.round(6 + 10 * s)
    for (let i = 0; i < n; i++) {
      const ang = Math.atan2(ny, nx) + (Math.random() * 2 - 1) * 1.1
      const spd = this.maze.cell * (1.2 + 2.8 * s) * (0.35 + 0.85 * Math.random())
      this.particles.push({
        x: px,
        y: py,
        vx: Math.cos(ang) * spd + this.ball.vx * 0.15,
        vy: Math.sin(ang) * spd + this.ball.vy * 0.15,
        t: 0,
        life: 0.3 + 0.3 * Math.random(),
        color: Math.random() < 0.6 ? '#fda4af' : '#ffffff',
        size: this.maze.th * (0.5 + 0.6 * Math.random()),
      })
    }
    if (this.particles.length > 140) this.particles.splice(0, this.particles.length - 140)
  }

  private startPreview(): void {
    this.grenades = this.mode.grenadesPerLevel
    this.sonarCharges = 1
    this.sonarFill = 0
    if (this.modifier === 'silence') {
      this.drainT = -1
      this.phase = 'playing'
      this.announceModifier()
      return
    }
    this.previewT = 0
    this.phase = 'preview'
  }

  private announceModifier(): void {
    const l = this.modifierLabel()
    if (!l) return
    this.popup(this.ball.x, this.ball.y - this.ball.r - 34, l, '#fcd34d', 1.35)
    if (this.zones.length > 0) {
      this.popup(
        this.ball.x,
        this.ball.y - this.ball.r - 58,
        `${this.zones.length} ZONE${this.zones.length > 1 ? 'S' : ''} D'ANOMALIE`,
        '#c4b5fd',
        1.05,
      )
    }
  }

  fireSonar(): void {
    if (this.phase !== 'playing' || this.arena) return
    if (this.sonarCharges <= 0) {
      this.popup(this.ball.x, this.ball.y - this.ball.r - 8, 'SONAR DÉCHARGÉ', '#94a3b8')
      return
    }
    this.sonarCharges--
    this.sonarT0 = this.clock
    this.sonarPrevR = 0
    this.audio.ping()
    this.input.rumble(0.2, 0.5, 90)
  }

  useFlashPublic(): void {
    this.useFlash()
  }

  private revealBand(r0: number, r1: number, rangePx: number): void {
    const m = this.maze
    for (let id = 0; id < m.walls.length; id++) {
      const w = m.walls[id]
      const d = Math.hypot(w.x + w.w / 2 - this.ball.x, w.y + w.h / 2 - this.ball.y)
      if (d > r0 && d <= r1) {
        this.softReveal(id, Math.max(0.25, 1 - d / rangePx) * 0.9, 'probe')
      }
    }
  }

  private portalCheck(): void {
    if (this.portalCell === null || this.portalConsumed) return
    if (this.clock < this.portalCooldownUntil) return
    const [cx, cy] = this.portalCell
    const px = this.maze.ox + (cx + 0.5) * this.maze.cell
    const py = this.maze.oy + (cy + 0.5) * this.maze.cell
    if (Math.hypot(this.ball.x - px, this.ball.y - py) < this.maze.cell * 0.33) {
      this.enterArena()
    }
  }

  private enterArena(): void {
    const cell = this.maze.cell
    const Aw = cell * 7
    const Ah = cell * 4.2
    const Ax = (BOARD - Aw) / 2
    const Ay = (BOARD - Ah) / 2
    const kind = this.portalKind
    this.savedPos = { x: this.ball.x, y: this.ball.y }
    const spikes: { x: number; y: number; w: number; h: number }[] = []
    if (kind === 'chargeur') {
      const th = cell * 0.3
      const spanH = Aw * 0.36
      const spanV = Ah * 0.36
      const edges = ['top', 'bottom', 'left', 'right'].sort(() => Math.random() - 0.5)
      for (const e of edges.slice(0, 2)) {
        if (e === 'top') {
          spikes.push({ x: Ax + (Aw - spanH) * (0.2 + Math.random() * 0.6), y: Ay, w: spanH, h: th })
        } else if (e === 'bottom') {
          spikes.push({ x: Ax + (Aw - spanH) * (0.2 + Math.random() * 0.6), y: Ay + Ah - th, w: spanH, h: th })
        } else if (e === 'left') {
          spikes.push({ x: Ax, y: Ay + (Ah - spanV) * (0.2 + Math.random() * 0.6), w: th, h: spanV })
        } else {
          spikes.push({ x: Ax + Aw - th, y: Ay + (Ah - spanV) * (0.2 + Math.random() * 0.6), w: th, h: spanV })
        }
      }
    }
    this.arena = {
      kind,
      hp: kind === 'chargeur' ? 3 : 99,
      shields: kind === 'tisseur' ? 2 : 2,
      invulnT: -1,
      t: 0,
      nextAttackAt: this.clock + 1,
      patternIdx: 0,
      pending: [],
      haz: [],
      windup: -1,
      lungeUntil: -1,
      ldx: 0,
      ldy: -1,
      nextDashAt: this.clock + 1.8,
      windupDur: 0.4,
      dashCombo: 0,
      bounces: 0,
      shocks: [],
      spikes,
      stunUntil: -1,
      bx: BOARD / 2,
      by: Ay + cell * 0.9,
      bvx: cell * 3.4,
      bvy: cell * 2.9,
      br: cell * (kind === 'chargeur' ? 0.42 : 0.36),
      flash: -1,
      Ax,
      Ay,
      Aw,
      Ah,
    }
    if (kind === 'chargeur') {
      const Aa = this.arena!
      const cands: [number, number][] = [
        [BOARD / 2, Ay + Ah / 2],
        [BOARD / 2 - Aw * 0.25, Ay + Ah / 2],
        [BOARD / 2 + Aw * 0.25, Ay + Ah / 2],
        [BOARD / 2, Ay + Ah * 0.28],
        [BOARD / 2, Ay + Ah * 0.72],
      ]
      for (const [cxp, cyp] of cands) {
        const safe = !spikes.some(
          (s) =>
            cxp > s.x - cell * 0.5 &&
            cxp < s.x + s.w + cell * 0.5 &&
            cyp > s.y - cell * 0.5 &&
            cyp < s.y + s.h + cell * 0.5,
        )
        if (safe) {
          Aa.bx = cxp
          Aa.by = cyp
          break
        }
      }
    }
    this.ball.x = BOARD / 2
    this.ball.y = Ay + Ah - this.ball.r - 10
    this.ball.vx = 0
    this.ball.vy = 0
    this.trailEpoch++
    this.trailX = this.ball.x
    this.trailY = this.ball.y
    const label =
      kind === 'chargeur'
        ? 'LE CHARGEUR S\u2019ÉVEILLE'
        : 'LE TISSEUR — SURVIS 12s'
    this.popup(BOARD / 2, Ay - 26, label, '#fb923c', 1.3)
    this.audio.ping()
    this.input.rumble(0.6, 0.2, 160)
    this.shake = Math.min(1, this.shake + 0.35)
  }

  private hitPlayer(kx: number, ky: number): boolean {
    if (this.god) return false
    const A = this.arena!
    if (this.clock < A.invulnT) return false
    A.shields--
    A.invulnT = this.clock + 1.1
    const b = this.ball
    const d = Math.hypot(kx, ky) || 1
    b.vx = (kx / d) * this.maze.cell * 3.2
    b.vy = (ky / d) * this.maze.cell * 3.2
    this.audio.impact(0.8)
    this.input.rumble(0.8, 0.6, 140)
    this.shake = Math.min(1, this.shake + 0.55)
    if (A.shields < 0) {
      this.failArena()
      return true
    }
    this.popup(b.x, b.y - b.r - 10, `BOUCLIER ${A.shields + 1}`, '#fda4af', 1.15)
    return false
  }

  private failArena(): void {
    const A = this.arena!
    this.popup(BOARD / 2, A.Ay + A.Ah / 2, 'ÉCHEC DU GARDIEN', '#fda4af', 1.4)
    this.portalCooldownUntil = this.clock + 2.5
    this.exitArena()
    this.startResume()
  }

  resumeCountdown = 0

  private startResume(): void {
    this.resumeCountdown = 3
    this.audio.tick()
  }

  private arenaStep(dt: number): void {
    const A = this.arena!
    const b = this.ball
    const cell = this.maze.cell
    A.t += dt

    const dm = this.input.directMove()
    if (dm) {
      const k = Math.min(1, dt * 24)
      b.vx = ((dm.x - b.x) * k) / dt
      b.vy = ((dm.y - b.y) * k) / dt
      const fd = Math.exp(-0.6 * dt)
      b.vx *= fd
      b.vy *= fd
    } else {
      const st = this.input.leftStick()
      b.vx += st.x * 3650 * dt
      b.vy += st.y * 3650 * dt
      const damp = Math.exp(-3.05 * dt)
      b.vx *= damp
      b.vy *= damp
    }
    const pMax = cell * 5.5
    let psp = Math.hypot(b.vx, b.vy)
    if (psp > pMax) {
      b.vx *= pMax / psp
      b.vy *= pMax / psp
      psp = pMax
    }
    const psteps = Math.min(4, Math.max(1, Math.ceil((psp * dt) / (b.r * 0.7))))
    const psdt = dt / psteps
    for (let i = 0; i < psteps; i++) {
      b.x += b.vx * psdt
      b.y += b.vy * psdt
      this.boundsBounce(b, b.r, 0.45)
    }

    if (A.kind === 'chargeur') {
      const stunned = this.clock < A.stunUntil
      const aiming = !stunned && A.windup > 0
      const lunging = !aiming && !stunned && this.clock < A.lungeUntil
      if (stunned) {
        // étourdi après impalement : immobile
      } else if (aiming) {
        const elapsed = this.clock - A.windup
        const lockWin = A.dashCombo === 0 ? 0.22 : 0.12
        if (elapsed < Math.max(0.05, A.windupDur - lockWin)) {
          const dx = b.x - A.bx
          const dy = b.y - A.by
          const d = Math.hypot(dx, dy) || 1
          A.ldx = dx / d
          A.ldy = dy / d
        }
        if (elapsed >= A.windupDur) {
          A.windup = -1
          A.lungeUntil = this.clock + (A.dashCombo === 0 ? 0.44 : 0.38)
          this.audio.ping()
        }
      } else if (lunging) {
        const lsp = cell * (A.dashCombo === 0 ? 9.8 : 10.4)
        A.bx += A.ldx * lsp * dt
        A.by += A.ldy * lsp * dt
      } else {
        A.bx += A.bvx * dt
        A.by += A.bvy * dt
        const wob = Math.sin(this.clock * 2.1)
        if (this.clock > this.bossTurnAt) {
          this.bossTurnAt = this.clock + 0.55 + Math.random() * 0.45
          const a = Math.atan2(A.bvy, A.bvx) + wob * 0.85
          const bs = Math.max(cell * 3.6, Math.hypot(A.bvx, A.bvy))
          A.bvx = Math.cos(a) * bs
          A.bvy = Math.sin(a) * bs
        }
        if (this.clock > A.nextDashAt) {
          A.nextDashAt = this.clock + 2.1 + Math.random() * 0.9
          A.dashCombo = 0
          A.windupDur = 0.24 + Math.random() * 0.36
          A.windup = this.clock
          this.audio.tick()
        }
        for (const s of A.spikes) {
          const cxr = Math.min(s.x + s.w, Math.max(s.x, A.bx))
          const cyr = Math.min(s.y + s.h, Math.max(s.y, A.by))
          const ddx = A.bx - cxr
          const ddy = A.by - cyr
          const dd = Math.hypot(ddx, ddy)
          if (dd < A.br) {
            if (dd > 1e-4) {
              A.bx = cxr + (ddx / dd) * A.br
              A.by = cyr + (ddy / dd) * A.br
            } else {
              A.bx = A.Ax + A.Aw / 2
              A.by = A.Ay + A.Ah / 2
            }
          }
        }
      }
      const co = { x: A.bx, y: A.by, vx: 0, vy: 0 }
      this.boundsBounce(co, A.br, 0)
      A.bx = co.x
      A.by = co.y

      if (lunging) {
        let spikeHit = false
        for (const s of A.spikes) {
          if (
            A.bx > s.x - A.br * 0.7 &&
            A.bx < s.x + s.w + A.br * 0.7 &&
            A.by > s.y - A.br * 0.7 &&
            A.by < s.y + s.h + A.br * 0.7
          ) {
            spikeHit = true
            break
          }
        }
        if (spikeHit) {
          A.hp--
          A.flash = this.clock
          A.stunUntil = this.clock + 0.85
          A.windup = -1
          A.lungeUntil = -1
          A.dashCombo = 0
          A.nextDashAt = this.clock + 1.4 + Math.random() * 0.6
          this.popup(A.bx, A.by - A.br - 12, 'EMPALÉ !', '#f87171', 1.35)
          this.audio.impact(1)
          this.audio.ping()
          this.input.rumble(1, 0.6, 200)
          this.shake = Math.min(1, this.shake + 0.8)
          this.spawnBurst(A.bx, A.by, 0, -1, 1)
          if (A.hp <= 0) {
            this.winArena()
            return
          }
        } else if (this.clock >= A.lungeUntil) {
          if (A.dashCombo === 0) {
            A.dashCombo = 1
            A.windupDur = 0.12 + Math.random() * 0.12
            A.windup = this.clock
            this.audio.tick()
          } else {
            A.dashCombo = 0
            A.windup = -1
            A.lungeUntil = -1
            A.nextDashAt = this.clock + 2.3 + Math.random() * 0.9
          }
        }
      }
    }

    if (A.kind === 'tisseur') {
      const tier = Math.min(2, Math.floor(this.level / 2))
      const spd = 1 + 0.12 * tier
      const cadence = 1.9 - 0.22 * tier
      A.bx = A.Ax + A.Aw / 2
      A.by = A.Ay + A.Ah * 0.26 + Math.sin(this.clock * 2.2) * cell * 0.14
      while (A.pending.length > 0 && A.pending[0].at <= this.clock) {
        const item = A.pending.shift()!
        A.haz.push(item.make())
        this.audio.tick()
      }
      if (this.clock >= A.nextAttackAt) {
        const k = A.patternIdx % 5
        A.patternIdx++
        A.nextAttackAt = this.clock + cadence
        if (k === 0) {
          const aimN = tier >= 2 ? 4 : 3
          for (let i = 0; i < aimN; i++) {
            A.pending.push({
              at: this.clock + i * 0.13,
              make: () => {
                const dxp = b.x - A.bx
                const dyp = b.y - A.by
                const dp = Math.hypot(dxp, dyp) || 1
                const sp3 = cell * 3.3 * spd
                return { kind: 'orb' as const, x: A.bx, y: A.by, vx: (dxp / dp) * sp3, vy: (dyp / dp) * sp3, r: cell * 0.16, w: 0, h: 0 }
              },
            })
          }
        } else if (k === 1) {
          const ringN = 11 + 2 * tier
          for (let i = 0; i < ringN; i++) {
            const a = (i / ringN) * Math.PI * 2 + this.clock * 0.4
            const sp2 = cell * 2.4 * spd
            A.haz.push({ kind: 'orb', x: A.bx, y: A.by, vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2, r: cell * 0.15, w: 0, h: 0 })
          }
        } else if (k === 2) {
          const gapW = cell * (1.7 - 0.22 * tier)
          const gx = A.Ax + gapW / 2 + Math.random() * (A.Aw - gapW)
          const th = cell * 0.32
          const segL = gx - gapW / 2 - A.Ax
          const segR = A.Ax + A.Aw - (gx + gapW / 2)
          const vy = cell * (2.8 + 0.25 * tier)
          if (segL > 4) A.haz.push({ kind: 'bar', x: A.Ax, y: A.Ay - th, vx: 0, vy, r: 0, w: segL, h: th })
          if (segR > 4) A.haz.push({ kind: 'bar', x: gx + gapW / 2, y: A.Ay - th, vx: 0, vy, r: 0, w: segR, h: th })
        } else if (k === 3) {
          const base = this.clock * 0.6
          const n = 5 + tier
          for (let i = 0; i < n; i++) {
            const a = base + i * 0.55
            const sp3 = cell * 2.9 * spd
            A.pending.push({
              at: this.clock + i * 0.11,
              make: () => {
                const aa = a + (this.clock - base) * 1.4
                return { kind: 'orb' as const, x: A.bx, y: A.by, vx: Math.cos(aa) * sp3, vy: Math.sin(aa) * sp3, r: cell * 0.15, w: 0, h: 0 }
              },
            })
          }
        } else {
          const th2 = cell * 0.32
          const gy = A.Ay + A.Ah / 2 + (Math.random() - 0.5) * (A.Ah - cell * 2.2)
          const segT = gy - cell * 0.85 - A.Ay
          const segB = A.Ay + A.Ah - (gy + cell * 0.85)
          const vx = -cell * (2.6 + 0.25 * tier) * (Math.random() < 0.5 ? -1 : 1)
          if (segT > 4) A.haz.push({ kind: 'bar', x: vx < 0 ? A.Ax + A.Aw : A.Ax - th2, y: A.Ay, vx, vy: 0, r: 0, w: th2, h: segT })
          if (segB > 4) A.haz.push({ kind: 'bar', x: vx < 0 ? A.Ax + A.Aw : A.Ax - th2, y: gy + cell * 0.85, vx, vy: 0, r: 0, w: th2, h: segB })
        }
      }
      for (let i = A.haz.length - 1; i >= 0; i--) {
        const hz = A.haz[i]
        hz.x += hz.vx * dt
        hz.y += hz.vy * dt
        if (
          hz.x < A.Ax - 60 ||
          hz.x > A.Ax + A.Aw + 60 ||
          hz.y < A.Ay - 80 ||
          hz.y > A.Ay + A.Ah + 60
        ) {
          A.haz.splice(i, 1)
        }
      }
      let dead = false
      for (const hz of A.haz) {
        let hit = false
        let kx = b.x - hz.x
        let ky = b.y - hz.y
        if (hz.kind === 'orb') {
          hit = Math.hypot(kx, ky) < b.r + hz.r
        } else {
          const cxr = Math.min(hz.x + hz.w, Math.max(hz.x, b.x))
          const cyr = Math.min(hz.y + hz.h, Math.max(hz.y, b.y))
          kx = b.x - cxr
          ky = b.y - cyr
          hit = Math.hypot(kx, ky) < b.r
        }
        if (hit) {
          if (hz.kind === 'orb') {
            hz.x = -9999
            hz.y = -9999
          }
          dead = this.hitPlayer(kx, ky)
          break
        }
      }
      if (dead || A.shields < 0) return
    }

    const surviveT = A.kind === 'tisseur' ? 12 : Number.POSITIVE_INFINITY
    if (A.t >= surviveT) {
      this.winArena()
      return
    }

    if (A.kind === 'chargeur') {
      const dx = b.x - A.bx
      const dy = b.y - A.by
      const d = Math.hypot(dx, dy) || 1
      const rr = b.r + A.br
      if (d < rr) {
        const nx = dx / d
        const ny = dy / d
        const lunging = this.clock < A.lungeUntil
        if (lunging) {
          this.hitPlayer(nx, ny)
        } else {
          b.x = A.bx + nx * rr
          b.y = A.by + ny * rr
          const vn = b.vx * nx + b.vy * ny
          if (vn < 0) {
            b.vx -= 1.5 * vn * nx
            b.vy -= 1.5 * vn * ny
          }
        }
      }
    }

    this.speedNorm = Math.min(1, Math.hypot(b.vx, b.vy) / (cell * 5.2))
  }

  private boundsBounce(
    o: { x: number; y: number; vx: number; vy: number },
    r: number,
    e: number,
  ): boolean {
    const A = this.arena!
    let bounced = false
    if (o.x < A.Ax + r) {
      o.x = A.Ax + r
      o.vx = Math.abs(o.vx) * e
      bounced = true
    }
    if (o.x > A.Ax + A.Aw - r) {
      o.x = A.Ax + A.Aw - r
      o.vx = -Math.abs(o.vx) * e
      bounced = true
    }
    if (o.y < A.Ay + r) {
      o.y = A.Ay + r
      o.vy = Math.abs(o.vy) * e
      bounced = true
    }
    if (o.y > A.Ay + A.Ah - r) {
      o.y = A.Ay + A.Ah - r
      o.vy = -Math.abs(o.vy) * e
      bounced = true
    }
    return bounced
  }

  private winArena(): void {
    const A = this.arena!
    for (let id = 0; id < this.maze.walls.length; id++) {
      if (Math.random() < 0.3) this.softReveal(id, 0.85, 'probe')
    }
    this.grenades = Math.min(9, this.mode.grenadesPerLevel)
    const pts = Math.round(250 * this.mode.mult)
    this.levelPoints += pts
    this.chain += COMBO_STEP * 2
    this.mult = Math.min(MULT_MAX, 1 + Math.floor(this.chain / COMBO_STEP))
    this.popup(BOARD / 2, A.Ay + A.Ah / 2, `GARDIEN VAINCU · +${pts} PTS`, '#fcd34d', 1.5)
    this.popup(
      BOARD / 2,
      A.Ay + A.Ah / 2 + 30,
      `⚡ RECHARGÉS (${this.grenades})`,
      '#67e8f9',
    )
    this.audio.win(2)
    this.input.rumble(1, 0.8, 260)
    this.shake = 1
    this.spawnBurst(A.bx, A.by, 0, -1, 1)
    this.portalConsumed = true
    this.exitArena()
    this.startResume()
  }

  private exitArena(): void {
    this.ball.x = this.savedPos.x
    this.ball.y = this.savedPos.y
    this.ball.vx = 0
    this.ball.vy = 0
    this.trailX = this.ball.x
    this.trailY = this.ball.y
    this.arena = null
    this.trailEpoch++
  }

  get previewWaiting(): boolean {
    return this.phase === 'preview' && this.previewT >= this.previewDur
  }

  private useFlash(): void {
    if (this.phase !== 'playing' || this.arena) return
    const b = this.ball
    if (this.grenades > 0) {
      this.grenades--
      this.levelFlashes++
      this.doFlash()
      this.popup(b.x, b.y - b.r - 8, 'ÉCLAIR', '#c4b5fd')
      return
    }
    const cost = this.flashNextCost
    if (this.totalScore >= cost) {
      this.totalScore -= cost
      this.flashPaidUsed++
      this.levelFlashes++
      this.levelFlashSpent += cost
      this.runFlashSpent += cost
      this.doFlash()
      this.popup(b.x, b.y - b.r - 8, `-${cost} PTS`, '#fcd34d', 1.15)
    } else {
      this.popup(b.x, b.y - b.r - 8, `MANQUE ${cost - this.totalScore} PTS`, '#f87171')
    }
  }

  get flashNextCost(): number {
    return FLASH_PAID_BASE + this.flashPaidUsed * FLASH_PAID_STEP
  }

  private doFlash(): void {
    this.flashAt = this.clock
    this.shake = Math.min(1, this.shake + 0.3)
    const m = this.maze
    const r = m.cell * FLASH_RADIUS_CELLS
    for (let id = 0; id < m.walls.length; id++) {
      const w = m.walls[id]
      const wx = w.x + w.w / 2
      const wy = w.y + w.h / 2
      if (Math.hypot(wx - this.ball.x, wy - this.ball.y) < r + (w.w > w.h ? w.w : w.h) / 2) {
        this.softReveal(id, 0.85, 'probe')
      }
    }
    this.input.rumble(0.4, 0.9, 180)
    this.audio.flash()
  }

  get runFlashSpentPts(): number {
    return this.runFlashSpent
  }

  topRuns(modeId: string): RunEntry[] {
    try {
      return JSON.parse(localStorage.getItem(`labyrinthe-top-${modeId}`) ?? '[]') as RunEntry[]
    } catch {
      return []
    }
  }

  private saveTopRun(entry: RunEntry): number | null {
    try {
      const list = this.topRuns(this.mode.id)
      list.push(entry)
      list.sort((a, b) => b.score - a.score)
      const top = list.slice(0, 5)
      localStorage.setItem(`labyrinthe-top-${this.mode.id}`, JSON.stringify(top))
      const idx = top.indexOf(entry)
      return idx >= 0 ? idx + 1 : null
    } catch {
      return null
    }
  }

  private resumePhase: Phase | null = null

  requestPause(): void {
    if (this.phase === 'playing' || this.phase === 'preview') this.enterPause()
  }

  togglePause(): void {
    if (this.phase === 'paused') this.exitPause()
    else this.requestPause()
  }

  trailUserMul = 1
  dev = false
  god = false
  noclip = false
  timeScale = 1
  devFps = 60

  private speedSteps = [0.25, 0.5, 1, 2]
  private speedIdx = 2

  devSlower(): void {
    this.speedIdx = Math.max(0, this.speedIdx - 1)
    this.timeScale = this.speedSteps[this.speedIdx]
  }

  devFaster(): void {
    this.speedIdx = Math.min(this.speedSteps.length - 1, this.speedIdx + 1)
    this.timeScale = this.speedSteps[this.speedIdx]
  }

  devCycleModifier(): void {
    const order: (Modifier | null)[] = [null, 'rush', 'silence']
    const idx = order.indexOf(this.modifier)
    this.modifier = order[(idx + 1) % order.length]
    this.announceModifier()
  }

  devAddZone(): void {
    const kinds: ('courant' | 'noir')[] = ['courant', 'noir']
    const existing = this.zones.length
    if (existing >= 2) {
      this.zones = []
      return
    }
    const kind = kinds[existing % 2]
    const m = this.maze
    const cx = Math.max(0, Math.min(m.cols - 5, Math.floor((this.ball.x - m.ox) / m.cell) - 2))
    const cy = Math.max(0, Math.min(m.rows - 5, Math.floor((this.ball.y - m.oy) / m.cell) - 2))
    let dx = 0
    let dy = 0
    if (kind === 'courant') {
      const a = Math.floor(Math.random() * 4)
      dx = [1, 0, -1, 0][a] * 480
      dy = [0, 1, 0, -1][a] * 480
    }
    this.zones.push({
      kind,
      x: m.ox + cx * m.cell + m.cell * 0.15,
      y: m.oy + cy * m.cell + m.cell * 0.15,
      w: 4 * m.cell - m.cell * 0.3,
      h: 4 * m.cell - m.cell * 0.3,
      dx,
      dy,
      cx: m.ox + (cx + 2) * m.cell,
      cy: m.oy + (cy + 2) * m.cell,
    })
  }

  devRefill(): void {
    this.grenades = this.mode.grenadesPerLevel
    this.sonarCharges = SONAR_MAX
    this.sonarFill = 0
  }

  devRevealAll(): void {
    for (let id = 0; id < this.maze.walls.length; id++) {
      this.softReveal(id, 0.9, 'probe')
    }
  }

  devTeleportPortal(): void {
    if (this.portalCell === null) {
      const p = this.maze.path[Math.floor(this.maze.path.length * 0.55)]
      this.portalCell = [p[0], p[1]]
      this.portalConsumed = false
    }
    this.ball.x = this.maze.ox + (this.portalCell[0] + 0.5) * this.maze.cell
    this.ball.y = this.maze.oy + (this.portalCell[1] + 0.5) * this.maze.cell
    this.ball.vx = 0
    this.ball.vy = 0
    this.trailEpoch++
    this.trailX = this.ball.x
    this.trailY = this.ball.y
  }

  devArena(): void {
    if (this.phase !== 'playing') {
      if (this.phase !== 'preview') return
      this.drainT = -1
      this.phase = 'playing'
    }
    this.devTeleportPortal()
    this.enterArena()
  }

  devCycleBoss(): void {
    const order: ('chargeur' | 'tisseur')[] = ['chargeur', 'tisseur']
    const idx = order.indexOf(this.portalKind)
    this.portalKind = order[(idx + 1) % order.length]
    this.portalConsumed = false
    this.portalCooldownUntil = -1
    if (this.portalCell === null) {
      const p = this.maze.path[Math.floor(this.maze.path.length * 0.55)]
      this.portalCell = [p[0], p[1]]
    }
  }

  devGoto(n: number): void {
    if (this.phase !== 'playing' && this.phase !== 'preview' && this.phase !== 'paused') return
    if (this.arena) this.exitArena()
    this.level = Math.max(0, Math.min(RUN_LENGTH - 1, n))
    this.maze = this.makeLevel(this.level)
    this.reveals.clear()
    this.trailEpoch++
    this.resetBall()
    this.levelTime = 0
    this.resetLevelStats()
    this.titleCls = ''
    this.startPreview()
    this.audio.begin()
  }

  skipResume(): void {
    this.resumeCountdown = 0
  }

  resetLevel(): void {
    if (this.phase !== 'playing' && this.phase !== 'preview' && this.phase !== 'paused') return
    if (this.arena) this.exitArena()
    this.resumePhase = null
    this.reveals.clear()
    this.trailEpoch++
    this.resetBall()
    this.levelTime = 0
    this.resetLevelStats()
    this.drainT = -1
    this.previewT = 0
    this.phase = 'playing'
    this.announceModifier()
  }

  controlKind(): 'pad' | 'touch' | 'mouse' {
    return this.input.kind
  }

  promptStartText(): string {
    return this.input.promptStart()
  }

  private enterPause(): void {
    this.resumePhase = this.phase
    const k = this.controlKind()
    this.messageTitle = 'PAUSE'
    this.messageSub =
      k === 'pad'
        ? 'Chrono et grille figés\nⒶ / Start pour reprendre'
        : k === 'touch'
          ? 'Chrono et grille figés\nTouche l\u2019écran pour reprendre'
          : 'Chrono et grille figés\nClic ou Entrée pour reprendre'
    this.titleCls = ''
    this.phase = 'paused'
    this.muteLayers()
  }

  private exitPause(): void {
    this.phase = this.resumePhase ?? 'playing'
    this.resumePhase = null
  }

  private muteLayers(): void {
    this.audio.setRoll(0)
    this.audio.setProbe(false)
    this.audio.setCombo(0)
    this.audio.setNear(0)
  }

  previewState(): { u: number; cut: number; alpha: number } | null {
    if (this.phase === 'preview') {
      return { u: Math.min(1, this.previewT / this.previewDur), cut: 0, alpha: 0.9 }
    }
    if (this.drainT >= 0) {
      const q = Math.min(1, this.drainT / this.drainDur)
      const cut = Math.pow(q, 2.6)
      return { u: 1, cut, alpha: 0.9 - 0.35 * q }
    }
    return null
  }

  private popup(x: number, y: number, text: string, color: string, size = 1): void {
    this.popups.push({ x, y, text, color, size, t: this.clock })
  }

  private nextLevel(): void {
    this.level++
    this.maze = this.makeLevel(this.level)
    this.reveals.clear()
    this.trailEpoch++
    this.resetBall()
    this.levelTime = 0
    this.resetLevelStats()
    this.titleCls = ''
    this.startPreview()
    this.audio.begin()
  }

  private resetLevelStats(): void {
    this.levelImpacts = 0
    this.levelImpactsKnown = 0
    this.levelProbed.clear()
    this.probedForgiven.clear()
    this.knownWalls.clear()
    this.impactAt.clear()
    this.lastImpactAny = -1
    this.grazeAt.clear()
    this.portalConsumed = false
    this.grazeAt.clear()
    this.chain = 0
    this.mult = 1
    this.comboT = 0
    this.levelPoints = 0
    this.flashPaidUsed = 0
    this.levelFlashes = 0
    this.levelFlashSpent = 0
    this.resumeCountdown = 0
    this.levelMaxSp = 0
    this.levelDist = 0
    this.levelMaxChain = 0
  }

  private resetRun(): void {
    this.level = 0
    this.totalScore = 0
    this.runResults = []
    this.runFlashSpent = 0
    this.maze = this.makeLevel(0)
    this.reveals.clear()
    this.trailEpoch++
    this.resetBall()
    this.totalTime = 0
    this.levelTime = 0
    this.resetLevelStats()
    this.titleCls = ''
    this.startPreview()
    this.audio.begin()
  }

  private showRecap(): void {
    const lines = this.runResults.map(
      (r, i) =>
        `${i + 1}. ${r.size}×${r.size}   ${fmtTime(r.time)}   ${r.impacts} imp.${
          r.impactsKnown > 0 ? ` dont ${r.impactsKnown} connu(s)` : ''
        }   ${r.probed} palpés   ⚡${r.flashes}   ${r.rank}   +${r.points.toLocaleString('fr-FR')}`,
    )
    let sub =
      lines.join('\n') +
      `\n\nTOTAL : ${this.totalScore.toLocaleString('fr-FR')} pts en ${fmtTime(
        this.totalTime,
      )} — mode ${this.mode.name}`
    if (this.runFlashSpent > 0) {
      sub += `\nÉclairs payés : -${this.runFlashSpent.toLocaleString('fr-FR')} pts`
    }
    if (this.saveRecordRun(this.totalScore)) sub += '\nNOUVEAU RECORD !'
    else {
      const rec = this.recordRun(this.mode.id)
      if (rec !== null) sub += `\nRecord : ${rec.toLocaleString('fr-FR')} pts`
    }
    const pos = this.saveTopRun({
      score: this.totalScore,
      time: this.totalTime,
      date: new Date().toISOString(),
    })
    if (pos !== null && pos <= 3) sub += `\n★ TOP ${pos} LOCAL !`
    const tops = this.topRuns(this.mode.id)
    if (tops.length > 0) {
      sub += `\nMeilleurs runs : ${tops.map((t) => t.score.toLocaleString('fr-FR')).join(' · ')}`
    }
    this.messageTitle = 'RUN TERMINÉ !'
    this.messageSub = sub
    this.titleCls = ''
    this.phase = 'recap'
  }

  private physics(dt: number): void {
    const b = this.ball
    const dm = this.input.directMove()
    let zx = 0
    let zy = 0
    for (const z of this.zones) {
      if (b.x < z.x || b.x > z.x + z.w || b.y < z.y || b.y > z.y + z.h) continue
      if (z.kind === 'courant') {
        zx += z.dx
        zy += z.dy
      } else {
        const dx = z.cx - b.x
        const dy = z.cy - b.y
        const d = Math.hypot(dx, dy) || 1
        const rz = Math.min(z.w, z.h) / 2
        const f = ZONE_NOIR_K * (0.35 + 0.65 * (1 - Math.min(1, d / rz)))
        zx += (dx / d) * f
        zy += (dy / d) * f
      }
    }
    if (dm) {
      const k = Math.min(1, dt * 24)
      b.vx = ((dm.x - b.x) * k) / dt
      b.vy = ((dm.y - b.y) * k) / dt
      const fd = Math.exp(-0.6 * dt)
      b.vx *= fd
      b.vy *= fd
      b.vx += zx * dt
      b.vy += zy * dt
    } else {
      const st = this.input.leftStick()
      b.vx += st.x * 3650 * dt + zx * dt
      b.vy += st.y * 3650 * dt + zy * dt
      const damp = Math.exp(-3.05 * dt)
      b.vx *= damp
      b.vy *= damp
    }
    const maxSp = this.maze.cell * 5.2 * (dm ? 1.6 : 1)
    let sp = Math.hypot(b.vx, b.vy)
    if (sp > maxSp) {
      b.vx *= maxSp / sp
      b.vy *= maxSp / sp
      sp = maxSp
    }
    const steps = Math.min(5, Math.max(1, Math.ceil((sp * dt) / (this.maze.th * 0.8))))
    const sdt = dt / steps
    for (let i = 0; i < steps; i++) {
      b.x += b.vx * sdt
      b.y += b.vy * sdt
      if (!this.noclip) this.collide()
    }
    const eff = sp > maxSp ? maxSp : sp
    this.speedNorm = eff / maxSp
    this.levelMaxSp = Math.max(this.levelMaxSp, eff)
    this.levelDist += eff * dt
    const m = this.maze
    const cc = Math.max(0, Math.min(m.cols - 1, Math.floor((b.x - m.ox) / m.cell)))
    const cr = Math.max(0, Math.min(m.rows - 1, Math.floor((b.y - m.oy) / m.cell)))
    const key = cr * m.cols + cc
    if (key !== this.lastCellKey) {
      this.lastCellKey = key
      if (!this.visited.has(key)) {
        this.visited.add(key)
        this.chain++
        this.comboT = this.stallNow()
        const newMult = Math.min(MULT_MAX, 1 + Math.floor(this.chain / COMBO_STEP))
        const tierUp = newMult > this.mult
        this.mult = newMult
        const pts = CELL_PTS * this.mult
        this.levelPoints += pts
        this.popup(b.x, b.y - b.r - 8, `+${pts}${this.mult > 1 ? ` ×${this.mult}` : ''}`, '#a5f3fc')
        if (tierUp) {
          this.popup(b.x, b.y - b.r - 30, `COMBO ×${this.mult}`, '#fcd34d', 1.5)
          this.audio.begin()
        }
      }
    }
    if (this.chain > this.levelMaxChain) this.levelMaxChain = this.chain
    this.probeUpdate()
  }

  private collide(): void {
    const b = this.ball
    const m = this.maze
    wallsNear(m, b.x - b.r - 1, b.y - b.r - 1, b.x + b.r + 1, b.y + b.r + 1, this.candidates)
    for (const id of this.candidates) {
      const w = m.walls[id]
      const px = Math.min(w.x + w.w, Math.max(w.x, b.x))
      const py = Math.min(w.y + w.h, Math.max(w.y, b.y))
      const dx = b.x - px
      const dy = b.y - py
      const d2 = dx * dx + dy * dy
      if (d2 >= b.r * b.r) continue
      let nx = 0
      let ny = 0
      let pen: number
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2)
        nx = dx / d
        ny = dy / d
        pen = b.r - d
      } else {
        const l = b.x - w.x
        const rr = w.x + w.w - b.x
        const tt = b.y - w.y
        const bb = w.y + w.h - b.y
        const mn = Math.min(l, rr, tt, bb)
        if (mn === l) {
          nx = -1
          pen = l + b.r
        } else if (mn === rr) {
          nx = 1
          pen = rr + b.r
        } else if (mn === tt) {
          ny = -1
          pen = tt + b.r
        } else {
          ny = 1
          pen = bb + b.r
        }
      }
      b.x += nx * pen
      b.y += ny * pen
      const vn = b.vx * nx + b.vy * ny
      if (vn < 0) {
        const e = 0.32
        b.vx -= (1 + e) * vn * nx
        b.vy -= (1 + e) * vn * ny
        const impact = -vn
        if (impact > m.cell * 0.65) {
          const s = Math.min(1, impact / (m.cell * 3))
          if (
            this.clock - (this.impactAt.get(id) ?? -1) > 0.5 &&
            this.clock - this.lastImpactAny > 0.15
          ) {
            this.impactAt.set(id, this.clock)
            this.lastImpactAny = this.clock
            if (!this.god) {
              this.levelImpacts++
              const known = this.knownWalls.has(id)
              if (known) this.levelImpactsKnown++
              if (!this.probedForgiven.has(id) && this.levelProbed.has(id)) {
                this.probedForgiven.add(id)
                this.popup(b.x, b.y - b.r - 8, 'MUR PALPÉ · PARDONNÉ', '#c4b5fd', 1.05)
              } else {
                const cost = known ? IMPACT_KNOWN_COST : IMPACT_UNKNOWN_COST
                this.levelImpactPen += cost
                this.levelPoints = Math.max(0, this.levelPoints - cost)
                this.chain = 0
                this.mult = 1
                this.popup(
                  b.x,
                  b.y - b.r - 8,
                  `-${cost}${known ? ' CONNU' : ''}`,
                  '#fda4af',
                  known ? 1.2 : 1,
                )
              }
            }
            this.softReveal(id, 1, 'hit')
            const rv = this.reveals.get(id)
            if (rv) rv.w = Math.min(1, (rv.w ?? 0) + 0.35 + 0.65 * s)
          }
          if (this.clock - this.lastHit > 0.07) {
            this.lastHit = this.clock
            this.input.rumble(0.25 + 0.75 * s, 0.15 + 0.35 * s, 40 + 110 * s)
            this.audio.impact(s)
            this.squash.ang = Math.atan2(ny, nx)
            this.squash.v = Math.min(this.squash.v, -(1.1 + 2.6 * s))
            if (s > 0.12) {
              this.shake = Math.min(1, this.shake + 0.25 + 0.75 * s)
              this.spawnBurst(px, py, nx, ny, s)
            }
          }
          this.softReveal(id, 1, 'hit')
        } else {
          this.grazeContact(id, px, py, nx, ny)
        }
      } else {
        this.grazeContact(id, px, py, nx, ny)
      }
    }
  }

  private grazeContact(
    id: number,
    px: number,
    py: number,
    nx: number,
    ny: number,
  ): void {
    this.softReveal(id, 0.55, 'hit')
    if (this.clock - (this.grazeAt.get(id) ?? -1) > 0.35) {
      this.grazeAt.set(id, this.clock)
      const b = this.ball
      if (Math.hypot(b.vx, b.vy) > this.maze.cell * 0.9) {
        this.sonarFill++
        this.audio.tick()
        for (let i = 0; i < 3; i++) {
          const a = Math.atan2(ny, nx) + (Math.random() * 2 - 1) * 0.9
          const spd = this.maze.cell * (0.5 + Math.random() * 0.6)
          this.particles.push({
            x: px,
            y: py,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            t: 0,
            life: 0.25 + Math.random() * 0.15,
            color: '#a5f3fc',
            size: this.maze.th * 0.32,
          })
        }
        if (this.sonarFill >= SONAR_GRAZE_NEED) {
          this.sonarFill = 0
          if (this.sonarCharges < SONAR_MAX) {
            this.sonarCharges++
            this.popup(b.x, b.y - b.r - 32, '📡 +1', '#67e8f9')
          } else {
            this.popup(b.x, b.y - b.r - 32, 'SONAR PLEIN', '#67e8f9', 0.9)
          }
        }
      }
    }
  }

  private softReveal(id: number, s: number, m: 'probe' | 'hit'): void {
    this.knownWalls.add(id)
    const cur = this.reveals.get(id)
    if (cur) {
      cur.t = this.clock
      cur.m = m
      if (s > cur.s) cur.s = s
    } else {
      this.reveals.set(id, { t: this.clock, s, m })
    }
  }

  private probeUpdate(): void {
    const rs = this.input.rightStick()
    this.probe.active = rs.m > 0.12
    let touched = false
    if (this.probe.active) {
      const inv = 1 / (Math.hypot(rs.x, rs.y) || 1)
      const dx = rs.x * inv
      const dy = rs.y * inv
      const b = this.ball
      const reach = b.r + this.maze.cell * 0.42
      const stepLen = Math.max(3, this.maze.th * 0.45)
      const n = Math.ceil(reach / stepLen)
      for (let i = 1; i <= n; i++) {
        const d = Math.min(i * stepLen, reach)
        const px = b.x + dx * d
        const py = b.y + dy * d
        wallsAtPoint(this.maze, px, py, this.probeHits)
        if (this.probeHits.length > 0) {
          for (const id of this.probeHits) {
            if (!this.levelProbed.has(id)) this.levelProbed.add(id)
            this.softReveal(id, 0.8, 'probe')
          }
          this.probe.x = px
          this.probe.y = py
          this.probe.touching = true
          touched = true
          if (this.clock - this.lastBuzz > 0.11) {
            this.lastBuzz = this.clock
            this.input.rumble(0.1, 0.6, 95)
          }
          break
        }
        this.probe.x = px
        this.probe.y = py
      }
    } else {
      this.probe.touching = false
    }
    if (touched !== this.wasTouching) {
      this.wasTouching = touched
    }
  }

  private atExit(): boolean {
    const [ex, ey] = this.cellCenter(this.maze.exit)
    return Math.hypot(this.ball.x - ex, this.ball.y - ey) < this.maze.cell * 0.34
  }

  private complete(): void {
    const done = this.level + 1
    const m = this.maze
    const base = m.cols * m.rows * BASE_PER_CELL
    const parT =
      m.path.length * PAR_SECONDS_PER_CELL * (this.modifier === 'rush' ? 0.78 : 1) + PAR_SLACK
    const ratio = Math.max(-1, Math.min(1, (2 * parT - this.levelTime) / parT))
    const timePts = Math.round(ratio * base * TIME_RATIO_WEIGHT)
    const cartoPts = this.levelProbed.size * CARTO_PTS
    const final = Math.max(
      0,
      Math.round((this.levelPoints + timePts + cartoPts) * this.mode.mult),
    )
    const rk = RANKS.find((r) => final >= r.k * m.cols * m.rows)
    const rankName = rk ? rk.name : '—'
    this.audio.win(rk ? 4 - RANKS.indexOf(rk) : 0)
    this.lastSummary = {
      time: this.levelTime,
      pathPts: this.levelPoints,
      timePts,
      cartoPts,
      impactPen: this.levelImpactPen,
      impacts: this.levelImpacts,
      impactsKnown: this.levelImpactsKnown,
      probed: this.levelProbed.size,
      flashes: this.levelFlashes,
      points: final,
      rankName,
      rankCls: rk ? `rank-${rk.cls}` : 'title-default',
      maxSpeedU: this.levelMaxSp / m.cell,
      maxChain: this.levelMaxChain,
      distCells: Math.round(this.levelDist / m.cell),
    }
    this.runResults.push({
      size: m.cols,
      time: this.levelTime,
      impacts: this.levelImpacts,
      impactsKnown: this.levelImpactsKnown,
      probed: this.levelProbed.size,
      flashes: this.levelFlashes,
      rank: rankName,
      points: final,
    })
    this.totalScore += final

    this.input.rumble(1, 0.5, 130)
    setTimeout(() => this.input.rumble(0.6, 0.35, 130), 170)
    setTimeout(() => this.input.rumble(1, 0.9, 240), 360)

    if (rk) {
      this.messageTitle = `NIVEAU ${done} — ${rankName}`
      this.titleCls = `rank-${rk.cls}`
    } else {
      this.messageTitle = `NIVEAU ${done} TERMINÉ`
      this.titleCls = ''
    }
    const impactsTxt =
      this.levelImpacts === 0
        ? 'aucun impact'
        : `${this.levelImpacts} impact(s)` +
          (this.levelImpactsKnown > 0 ? ` dont ${this.levelImpactsKnown} sur mur connu` : '')
    this.messageSub =
      `${fmtTime(this.levelTime)} · ${impactsTxt} · ${this.levelFlashes} éclair(s) · ${
        this.levelProbed.size
      } murs palpés${this.modifier ? ` · ${this.modifierLabel()}` : ''}\n` +
      `Parcours +${this.levelPoints.toLocaleString('fr-FR')} · Temps ${
        timePts >= 0 ? '+' : ''
      }${timePts} · Carto +${cartoPts} · Impacts -${this.levelImpactPen}\n` +
      `Mode ${this.mode.name} ×${this.mode.mult}\n` +
      `+${final.toLocaleString('fr-FR')} pts`
    this.levelPoints = 0
    this.phase = 'transition'
    this.transitionT = 0.8
  }
}
