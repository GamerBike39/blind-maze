import { BOARD, type Arena, type Game } from './game'

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private tctx: CanvasRenderingContext2D
  private trail: HTMLCanvasElement
  private bg: CanvasGradient
  private epoch = -1

  constructor(canvas: HTMLCanvasElement) {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(BOARD * dpr)
    canvas.height = Math.round(BOARD * dpr)
    this.ctx = canvas.getContext('2d')!
    this.ctx.scale(dpr, dpr)
    this.trail = document.createElement('canvas')
    this.trail.width = canvas.width
    this.trail.height = canvas.height
    this.tctx = this.trail.getContext('2d')!
    this.tctx.scale(dpr, dpr)
    const grad = this.ctx.createRadialGradient(BOARD / 2, BOARD / 2, 60, BOARD / 2, BOARD / 2, BOARD * 0.75)
    grad.addColorStop(0, '#0c1226')
    grad.addColorStop(1, '#05060d')
    this.bg = grad
  }

  draw(g: Game, dt: number): void {
    if (g.trailEpoch !== this.epoch) {
      this.epoch = g.trailEpoch
      this.tctx.clearRect(0, 0, BOARD, BOARD)
    }
    this.tctx.globalCompositeOperation = 'destination-out'
    const k = Math.min(0.95, 0.3 * g.mode.trailFadeMul * g.trailUserMul)
    this.tctx.fillStyle = `rgba(0,0,0,${(1 - Math.pow(k, dt)).toFixed(4)})`
    this.tctx.fillRect(0, 0, BOARD, BOARD)
    this.tctx.globalCompositeOperation = 'source-over'

    const dx = g.ball.x - g.trailX
    const dy = g.ball.y - g.trailY
    if (!g.arena && dx * dx + dy * dy > 0.2) {
      const t = this.tctx
      t.lineCap = 'round'
      t.lineJoin = 'round'
      t.strokeStyle = 'rgba(34,211,238,0.45)'
      t.lineWidth = g.ball.r * 1.15
      t.beginPath()
      t.moveTo(g.trailX, g.trailY)
      t.lineTo(g.ball.x, g.ball.y)
      t.stroke()
      t.strokeStyle = 'rgba(199,250,255,0.5)'
      t.lineWidth = g.ball.r * 0.45
      t.stroke()
      g.trailX = g.ball.x
      g.trailY = g.ball.y
    }

    const ctx = this.ctx
    ctx.fillStyle = this.bg
    ctx.fillRect(0, 0, BOARD, BOARD)
    ctx.save()
    if (g.shake > 0) {
      ctx.translate((Math.random() * 2 - 1) * g.shake * 8, (Math.random() * 2 - 1) * g.shake * 8)
    }
    const arena = g.arena
    if (!arena) {
      this.dots(g)
      this.zonesFx(g)
      this.previewPath(g)
      this.previewPrompt(g)
      const sinceFlash = g.clock - g.flashAt
      if (sinceFlash >= 0 && sinceFlash < 0.5) {
        const q = sinceFlash / 0.5
        ctx.strokeStyle = `rgba(199,250,255,${((1 - q) * 0.8).toFixed(3)})`
        ctx.lineWidth = g.maze.cell * 0.12 * (1 - q * 0.5)
        ctx.beginPath()
        ctx.arc(g.ball.x, g.ball.y, q * g.maze.cell * 3.2, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(this.trail, 0, 0, BOARD, BOARD)
      this.particles(g)
      ctx.globalCompositeOperation = 'source-over'
      this.revealed(g)
      this.sonarRing(g)
      this.startMark(g)
      this.exitMark(g)
      this.portalMark(g)
      this.hand(g)
    } else {
      this.arenaScene(g, arena)
      ctx.globalCompositeOperation = 'lighter'
      this.particles(g)
      ctx.globalCompositeOperation = 'source-over'
    }
    this.ballDraw(g)
    ctx.restore()
    this.popups(g)
  }

  private zonesFx(g: Game): void {
    const ctx = this.ctx
    const m = g.maze
    for (const z of g.zones) {
      ctx.fillStyle = z.kind === 'courant' ? 'rgba(34,211,238,0.05)' : 'rgba(88,28,135,0.10)'
      ctx.fillRect(z.x, z.y, z.w, z.h)
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = z.kind === 'courant' ? 'rgba(34,211,238,0.25)' : 'rgba(167,139,250,0.30)'
      ctx.lineWidth = 1.2
      ctx.strokeRect(z.x, z.y, z.w, z.h)
      ctx.setLineDash([])
      if (z.kind === 'courant') {
        const ang = Math.atan2(z.dy, z.dx)
        const s = m.cell * 0.11
        const spacing = m.cell * 0.85
        const off = (g.clock * m.cell * 1.35) % spacing
        ctx.save()
        ctx.beginPath()
        ctx.rect(z.x, z.y, z.w, z.h)
        ctx.clip()
        ctx.translate(z.x + z.w / 2, z.y + z.h / 2)
        ctx.rotate(ang)
        const W = Math.hypot(z.w, z.h) / 2 + m.cell
        for (let yy = -W; yy <= W; yy += spacing) {
          for (let xx = -W - spacing + off; xx <= W; xx += spacing) {
            const a = 0.16 + 0.08 * Math.sin(g.clock * 3 + xx * 0.04 + yy * 0.05)
            ctx.strokeStyle = `rgba(103,232,249,${a.toFixed(3)})`
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(xx - s, yy - s)
            ctx.lineTo(xx + s * 0.5, yy)
            ctx.lineTo(xx - s, yy + s)
            ctx.stroke()
          }
        }
        ctx.restore()
      } else {
        const R = Math.min(z.w, z.h) / 2
        ctx.fillStyle = 'rgba(3,2,10,0.85)'
        ctx.beginPath()
        ctx.arc(z.cx, z.cy, R * 0.42, 0, Math.PI * 2)
        ctx.fill()
        ctx.save()
        ctx.translate(z.cx, z.cy)
        ctx.rotate(g.clock * 0.5)
        ctx.setLineDash([4, 7])
        ctx.strokeStyle = 'rgba(167,139,250,0.4)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(0, 0, R * 0.62, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
        for (let i = 0; i < 9; i++) {
          const a = g.clock * (0.9 + i * 0.17) + i * 2.1
          const rad = R * (0.3 + 0.17 * ((i % 3) + 0.4))
          const x = z.cx + Math.cos(a) * rad
          const y = z.cy + Math.sin(a) * rad
          ctx.globalAlpha = 0.35
          ctx.fillStyle = '#c4b5fd'
          ctx.beginPath()
          ctx.arc(x, y, m.th * 0.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }
    }
  }

  private portalMark(g: Game): void {
    if (g.portalCell === null || g.portalConsumed || g.arena) return
    const m = g.maze
    const x = m.ox + (g.portalCell[0] + 0.5) * m.cell
    const y = m.oy + (g.portalCell[1] + 0.5) * m.cell
    const p = 0.5 + 0.5 * Math.sin(g.clock * 2.6)
    const s = m.cell * 0.18
    const ctx = this.ctx
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(Math.PI / 4 + g.clock * 1.4)
    ctx.shadowColor = '#fb923c'
    ctx.shadowBlur = 14 + 10 * p
    ctx.strokeStyle = `rgba(251,146,60,${(0.5 + 0.45 * p).toFixed(3)})`
    ctx.lineWidth = 2.5
    ctx.strokeRect(-s, -s, s * 2, s * 2)
    ctx.fillStyle = `rgba(253,186,116,${(0.5 + 0.4 * p).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(0, 0, m.cell * 0.07, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private arenaScene(g: Game, A: Arena): void {
    const ctx = this.ctx
    const chargeur = A.kind === 'chargeur'
    const accent = chargeur ? '#fb923c' : '#e879f9'
    ctx.fillStyle = 'rgba(2,2,8,0.55)'
    ctx.fillRect(0, 0, BOARD, BOARD)
    ctx.fillStyle = 'rgba(10,7,20,0.6)'
    ctx.beginPath()
    ctx.roundRect(A.Ax, A.Ay, A.Aw, A.Ah, 12)
    ctx.fill()
    ctx.save()
    ctx.shadowColor = accent
    ctx.shadowBlur = 22
    ctx.strokeStyle = chargeur ? 'rgba(251,146,60,0.85)' : 'rgba(232,121,249,0.85)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.roundRect(A.Ax, A.Ay, A.Aw, A.Ah, 12)
    ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(A.Ax + 6, A.Ay + 6, A.Aw - 12, A.Ah - 12, 9)
    ctx.stroke()
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = chargeur ? 'rgba(251,146,60,0.85)' : 'rgba(232,121,249,0.85)'
    ctx.fillText(
      chargeur ? 'PERCUTE-LE ×3' : `SURVIS — ${Math.max(0, 12 - A.t).toFixed(1)}s`,
      A.Ax + A.Aw / 2,
      A.Ay + A.Ah + 24,
    )
    ctx.restore()

    if (chargeur) {
      for (let i = 0; i < A.hp; i++) {
        const x = A.Ax + A.Aw / 2 + (i - (A.hp - 1) / 2) * 20
        const y = A.Ay + 16
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(Math.PI / 4)
        ctx.fillStyle = '#fb923c'
        ctx.shadowColor = '#fb923c'
        ctx.shadowBlur = 8
        ctx.fillRect(-4, -4, 8, 8)
        ctx.restore()
      }
      if (A.windup > 0 && g.clock - A.windup < 0.55) {
        const p = (g.clock - A.windup) / 0.55
        ctx.save()
        ctx.setLineDash([8, 8])
        ctx.strokeStyle = `rgba(253,164,175,${(0.35 + 0.45 * p).toFixed(3)})`
        ctx.lineWidth = 2 + p * 2
        ctx.beginPath()
        ctx.moveTo(A.bx, A.by)
        ctx.lineTo(A.bx + A.ldx * A.Aw * 0.7, A.by + A.ldy * A.Ah * 1.4)
        ctx.stroke()
        ctx.restore()
      }
    } else {
      for (let i = 0; i <= A.shields; i++) {
        const x = A.Ax + A.Aw / 2 + (i - A.shields / 2) * 20
        const y = A.Ay + 16
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(Math.PI / 4)
        if (i < A.shields) {
          ctx.fillStyle = '#67e8f9'
          ctx.shadowColor = '#67e8f9'
          ctx.shadowBlur = 8
        } else {
          ctx.strokeStyle = 'rgba(103,232,249,0.35)'
          ctx.lineWidth = 1.5
        }
        ctx.fillRect(-4, -4, 8, 8)
        if (!(i < A.shields)) ctx.strokeRect(-4, -4, 8, 8)
        ctx.restore()
      }
    }

    if (chargeur) {
      const grad = ctx.createRadialGradient(
        A.bx - A.br * 0.3,
        A.by - A.br * 0.3,
        1,
        A.bx,
        A.by,
        A.br,
      )
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(0.4, '#fdba74')
      grad.addColorStop(1, '#9a3412')
      ctx.save()
      ctx.shadowColor = '#fb923c'
      ctx.shadowBlur = 26
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(A.bx, A.by, A.br, 0, Math.PI * 2)
      ctx.fill()
      if (A.flash >= 0 && g.clock - A.flash < 0.18) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)'
        ctx.beginPath()
        ctx.arc(A.bx, A.by, A.br * 0.95, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#431407'
      ctx.beginPath()
      ctx.arc(A.bx, A.by, A.br * 0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else {
      ctx.save()
      ctx.translate(A.bx, A.by)
      ctx.rotate(g.clock * 2)
      ctx.shadowColor = '#e879f9'
      ctx.shadowBlur = 22
      ctx.strokeStyle = '#f0abfc'
      ctx.lineWidth = 3
      ctx.strokeRect(-A.br * 0.85, -A.br * 0.85, A.br * 1.7, A.br * 1.7)
      ctx.rotate(Math.PI / 4)
      ctx.strokeStyle = 'rgba(240,171,252,0.6)'
      ctx.lineWidth = 2
      ctx.strokeRect(-A.br * 0.85, -A.br * 0.85, A.br * 1.7, A.br * 1.7)
      ctx.restore()
      ctx.save()
      ctx.shadowColor = '#f0abfc'
      ctx.shadowBlur = 14
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(A.bx, A.by, A.br * 0.28, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      for (const hz of A.haz) {
        if (hz.kind === 'orb') {
          ctx.save()
          ctx.shadowColor = '#e879f9'
          ctx.shadowBlur = 12
          const og = ctx.createRadialGradient(hz.x, hz.y, 1, hz.x, hz.y, hz.r)
          og.addColorStop(0, '#ffffff')
          og.addColorStop(0.5, '#e879f9')
          og.addColorStop(1, 'rgba(232,121,249,0)')
          ctx.fillStyle = og
          ctx.beginPath()
          ctx.arc(hz.x, hz.y, hz.r * 1.6, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        } else {
          ctx.save()
          ctx.fillStyle = 'rgba(196,181,253,0.75)'
          ctx.strokeStyle = 'rgba(240,171,252,0.9)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.roundRect(hz.x, hz.y, hz.w, hz.h, 5)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
      }
    }
  }

  private particles(g: Game): void {
    if (g.particles.length === 0) return
    const ctx = this.ctx
    for (const p of g.particles) {
      const a = 1 - p.t / p.life
      ctx.globalAlpha = Math.max(0, a)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * a), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  private previewPath(g: Game): void {
    const st = g.previewState()
    if (st === null || g.previewPts.length < 2) return
    const pts = g.previewPts
    const m = g.maze
    const segs = pts.length - 1
    const f0 = Math.max(0, Math.min(1, st.cut)) * segs
    const f1 = Math.min(1, Math.max(0, st.u)) * segs
    if (f1 - f0 < 0.02) return
    const i0 = Math.floor(f0)
    const i1 = Math.min(segs - 1, Math.floor(f1))
    const fr0 = f0 - i0
    const fr1 = f1 - i1
    const sx = pts[i0][0] + (pts[i0 + 1][0] - pts[i0][0]) * fr0
    const sy = pts[i0][1] + (pts[i0 + 1][1] - pts[i0][1]) * fr0
    const gx = pts[i1][0] + (pts[i1 + 1][0] - pts[i1][0]) * fr1
    const gy = pts[i1][1] + (pts[i1 + 1][1] - pts[i1][1]) * fr1
    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = st.alpha
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.lineTo(gx, gy)
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'
    ctx.lineWidth = m.cell * 0.13
    ctx.stroke()
    ctx.strokeStyle = 'rgba(199,250,255,0.35)'
    ctx.lineWidth = m.cell * 0.05
    ctx.stroke()
    if (g.phase === 'preview' && g.previewT < g.previewDur) {
      ctx.shadowColor = '#ffffff'
      ctx.shadowBlur = 20
      ctx.fillStyle = `rgba(255,255,255,${(0.95 * st.alpha).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(gx, gy, g.ball.r * 0.75, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private previewPrompt(g: Game): void {
    if (!g.previewWaiting) return
    const ctx = this.ctx
    const b = g.ball
    const p = 0.55 + 0.45 * Math.sin(g.clock * 4.5)
    const text = g.controlKind() === 'pad' ? 'Ⓐ POUR PARTIR' : g.promptStartText()
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.font = `700 ${Math.round(Math.max(16, g.maze.cell * 0.34))}px "Segoe UI", system-ui, sans-serif`
    const halfW = ctx.measureText(text).width / 2
    let x = Math.min(BOARD - halfW - 16, Math.max(halfW + 16, b.x))
    let y = b.y - b.r - 14
    if (y < 34) y = b.y + b.r + 32
    y = Math.min(BOARD - 14, Math.max(30, y))
    ctx.shadowColor = '#22d3ee'
    ctx.shadowBlur = 14 * p
    ctx.fillStyle = `rgba(165,243,252,${p.toFixed(3)})`
    ctx.fillText(text, x, y)
    ctx.restore()
  }

  private popups(g: Game): void {
    if (g.popups.length === 0) return
    const ctx = this.ctx
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    for (const p of g.popups) {
      const age = g.clock - p.t
      const a = Math.max(0, 1 - age)
      ctx.globalAlpha = a * a * (3 - 2 * a)
      const y = p.y - age * 40
      ctx.font = `700 ${Math.round(19 * p.size)}px "Segoe UI", system-ui, sans-serif`
      ctx.lineWidth = 5
      ctx.strokeStyle = 'rgba(3,4,12,0.75)'
      ctx.strokeText(p.text, p.x, y)
      ctx.fillStyle = p.color
      ctx.fillText(p.text, p.x, y)
    }
    ctx.restore()
  }

  private dots(g: Game): void {
    const ctx = this.ctx
    const m = g.maze
    ctx.fillStyle = 'rgba(148,163,184,0.10)'
    for (let r = 1; r < m.rows; r++)
      for (let c = 1; c < m.cols; c++)
        ctx.fillRect(m.ox + c * m.cell - 1, m.oy + r * m.cell - 1, 2, 2)
  }

  private revealed(g: Game): void {
    const ctx = this.ctx
    const m = g.maze
    ctx.save()
    ctx.shadowBlur = 16
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const [id, rev] of g.reveals) {
      const a = rev.s * (1 - (g.clock - rev.t) / g.revealLife)
      if (a <= 0.02) continue
      const w = m.walls[id]
      let shadow: string
      let color: string
      if (rev.m === 'hit') {
        shadow = '#f43f5e'
        color = `rgba(253,164,175,${Math.min(0.95, a).toFixed(3)})`
      } else {
        shadow = '#7c3aed'
        color = `rgba(196,181,253,${Math.min(0.95, a).toFixed(3)})`
      }
      ctx.shadowColor = shadow
      const wob = rev.w ?? 0
      if (wob > 0.02) {
        const horiz = w.w > w.h
        const len = horiz ? w.w : w.h
        const sx = horiz ? w.x : w.x + w.w / 2
        const sy = horiz ? w.y + w.h / 2 : w.y
        const ax = horiz ? 1 : 0
        const ay = horiz ? 0 : 1
        const px = horiz ? 0 : 1
        const py = horiz ? 1 : 0
        const waves = Math.max(3, Math.round(len / (m.th * 3)))
        const amp = wob * m.th * 1.6
        const n = waves * 8
        ctx.strokeStyle = color
        ctx.lineWidth = m.th * 1.05
        ctx.beginPath()
        for (let i = 0; i <= n; i++) {
          const t = i / n
          const off = Math.sin(t * Math.PI * waves) * amp * Math.sin(Math.PI * t)
          const x = sx + ax * len * t + px * off
          const y = sy + ay * len * t + py * off
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      } else {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.roundRect(w.x, w.y, w.w, w.h, Math.min(w.w, w.h) / 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  private sonarRing(g: Game): void {
    const q = g.sonarProgress()
    if (q === null) return
    const ctx = this.ctx
    const m = g.maze
    const r = q * m.cell * 7
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `rgba(165,243,252,${((1 - q) * 0.75).toFixed(3)})`
    ctx.lineWidth = 3 * (1 - q) + 1
    ctx.beginPath()
    ctx.arc(g.ball.x, g.ball.y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = `rgba(255,255,255,${((1 - q) * 0.35).toFixed(3)})`
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(g.ball.x, g.ball.y, r * 0.88, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  private startMark(g: Game): void {
    const ctx = this.ctx
    const [sx, sy] = g.cellCenter(g.maze.start)
    const r = g.maze.cell * 0.3
    ctx.strokeStyle = 'rgba(52,211,153,0.9)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(52,211,153,0.35)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(sx, sy, r * 1.45, 0, Math.PI * 2)
    ctx.stroke()
  }

  private exitMark(g: Game): void {
    const ctx = this.ctx
    const [ex, ey] = g.cellCenter(g.maze.exit)
    const d = Math.hypot(g.ball.x - ex, g.ball.y - ey)
    const glow = Math.max(0, 1 - d / (g.maze.cell * 2.6))
    const p = 0.5 + 0.5 * Math.sin(g.clock * (3.4 + glow * 6))
    if (glow > 0.05) {
      const grad = ctx.createRadialGradient(ex, ey, 1, ex, ey, g.maze.cell * (0.6 + 0.4 * glow))
      grad.addColorStop(0, `rgba(232,121,249,${(0.16 * glow).toFixed(3)})`)
      grad.addColorStop(1, 'rgba(232,121,249,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(ex, ey, g.maze.cell * (0.6 + 0.4 * glow), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.save()
    ctx.translate(ex, ey)
    ctx.rotate(-g.clock * (0.9 + glow * 2))
    ctx.setLineDash([10, 9])
    ctx.strokeStyle = `rgba(232,121,249,${Math.min(1, 0.35 + 0.45 * p + 0.3 * glow).toFixed(3)})`
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(0, 0, g.maze.cell * 0.47, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    ctx.save()
    ctx.shadowColor = '#e879f9'
    ctx.shadowBlur = 18 + 10 * p + 22 * glow
    ctx.strokeStyle = `rgba(240,171,252,${Math.min(1, 0.6 + 0.35 * p + 0.2 * glow).toFixed(3)})`
    ctx.lineWidth = 3 + glow * 2
    ctx.beginPath()
    ctx.arc(ex, ey, g.maze.cell * 0.27 + p * 3, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  private hand(g: Game): void {
    if (!g.probe.active) return
    const ctx = this.ctx
    const b = g.ball
    ctx.save()
    ctx.setLineDash([5, 7])
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(g.probe.x, g.probe.y)
    ctx.stroke()
    ctx.restore()
    if (g.probe.touching) {
      ctx.save()
      ctx.shadowColor = '#f0abfc'
      ctx.shadowBlur = 14
      ctx.fillStyle = '#f0abfc'
      ctx.beginPath()
      ctx.arc(g.probe.x, g.probe.y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(g.probe.x, g.probe.y, 4, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  private ballDraw(g: Game): void {
    const ctx = this.ctx
    const b = g.ball
    const q = g.squash
    const invuln = g.arena !== null && g.clock < g.arena.invulnT
    const sp = Math.hypot(b.vx, b.vy)
    const stretch = Math.min(1, sp / (g.maze.cell * 5.2)) * 0.1
    const va = Math.atan2(b.vy, b.vx)
    ctx.save()
    if (invuln) ctx.globalAlpha = 0.45 + 0.35 * Math.sin(g.clock * 30)
    ctx.shadowColor = '#22d3ee'
    ctx.shadowBlur = 22
    ctx.translate(b.x, b.y)
    ctx.rotate(q.ang)
    ctx.scale(1 + q.a, 1 - q.a)
    ctx.rotate(-q.ang)
    if (sp > 1) {
      ctx.rotate(va)
      ctx.scale(1 + stretch, 1 - stretch)
      ctx.rotate(-va)
    }
    const grad = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.3, 1, 0, 0, b.r)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.55, '#a5f3fc')
    grad.addColorStop(1, '#0891b2')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(0, 0, b.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}
