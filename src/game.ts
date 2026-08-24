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
    desc: "L'expérience Koh-Lanta telle qu'elle a été pensée · ⚡3/niveau",
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
  private knownWalls = new Set<number>()
  private impactAt = new Map<number, number>()
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
    this.previewPts = mz.path.map((c) => this.cellCenter(c))
    this.previewDur = Math.min(3, Math.max(1.8, mz.path.length * 0.045))
    this.drainDur = Math.min(3, Math.max(1.2, this.previewDur * 0.75))
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
      this.physics(dt)
      if (this.input.flashEdge()) this.useFlash()
      const [ex, ey] = this.cellCenter(this.maze.exit)
      this.exitGlow = Math.max(
        0,
        1 - Math.hypot(this.ball.x - ex, this.ball.y - ey) / (this.maze.cell * 2.6),
      )
      if (this.atExit()) this.complete()
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
    this.previewT = 0
    this.drainT = -1
    this.phase = 'preview'
  }

  get previewWaiting(): boolean {
    return this.phase === 'preview' && this.previewT >= this.previewDur
  }

  private useFlash(): void {
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

  private enterPause(): void {
    this.resumePhase = this.phase
    this.messageTitle = 'PAUSE'
    this.messageSub =
      'Le chrono est figé — la grille aussi\nStart / Échap / P ou Ⓐ pour reprendre'
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
    this.knownWalls.clear()
    this.impactAt.clear()
    this.chain = 0
    this.mult = 1
    this.comboT = 0
    this.levelPoints = 0
    this.flashPaidUsed = 0
    this.levelFlashes = 0
    this.levelFlashSpent = 0
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
    const st = this.input.leftStick()
    b.vx += st.x * 3400 * dt
    b.vy += st.y * 3400 * dt
    const damp = Math.exp(-2.8 * dt)
    b.vx *= damp
    b.vy *= damp
    const sp = Math.hypot(b.vx, b.vy)
    const maxSp = this.maze.cell * 5.2
    if (sp > maxSp) {
      b.vx *= maxSp / sp
      b.vy *= maxSp / sp
    }
    const steps = Math.min(5, Math.max(1, Math.ceil((sp * dt) / (this.maze.th * 0.8))))
    const sdt = dt / steps
    for (let i = 0; i < steps; i++) {
      b.x += b.vx * sdt
      b.y += b.vy * sdt
      this.collide()
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
        this.comboT = COMBO_STALL
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
          if (this.clock - (this.impactAt.get(id) ?? -1) > 0.3) {
            this.impactAt.set(id, this.clock)
            this.levelImpacts++
            const known = this.knownWalls.has(id)
            if (known) this.levelImpactsKnown++
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
          this.softReveal(id, 0.55, 'hit')
        }
      } else {
        this.softReveal(id, 0.55, 'hit')
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
    const parT = m.path.length * PAR_SECONDS_PER_CELL + PAR_SLACK
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
      `${fmtTime(this.levelTime)} · ${impactsTxt} · ${this.levelFlashes} éclair(s) · ${this.levelProbed.size} murs palpés\n` +
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
