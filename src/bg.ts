function makeGlow(rgb: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `rgba(${rgb},1)`)
  grad.addColorStop(0.28, `rgba(${rgb},0.42)`)
  grad.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}

interface P {
  x: number
  y: number
  r: number
  l: number
  c: number
  a: number
  tw: number
  ph: number
}

export class Background {
  private ctx: CanvasRenderingContext2D
  private parts: P[] = []
  private sprCyan = makeGlow('34,211,238')
  private sprViolet = makeGlow('139,92,246')
  private sprGray = makeGlow('148,163,184')
  private x = window.innerWidth / 2
  private y = window.innerHeight / 2

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    this.resize()
    window.addEventListener('resize', () => this.resize())
    for (let i = 0; i < 170; i++) {
      const l = i % 3
      this.parts.push({
        x: -60 + Math.random() * (window.innerWidth + 120),
        y: -60 + Math.random() * (window.innerHeight + 120),
        r: [0.9, 1.3, 1.8][l] * (0.7 + Math.random() * 0.7),
        l,
        c: Math.random() < 0.45 ? 0 : Math.random() < 0.87 ? 1 : 2,
        a: [0.07, 0.09, 0.12][l],
        tw: 0.4 + Math.random() * 1.2,
        ph: Math.random() * Math.PI * 2,
      })
    }
  }

  private resize(): void {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    this.canvas.width = Math.round(window.innerWidth * dpr)
    this.canvas.height = Math.round(window.innerHeight * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  frame(bx: number, by: number, motion: number, dt: number, clock: number): void {
    const ctx = this.ctx
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    const k = Math.min(1, dt * 2.2)
    this.x += (bx - this.x) * k
    this.y += (by - this.y) * k
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const ns = Math.max(window.innerWidth, window.innerHeight) * 0.45 * (1 + 0.15 * motion)
    ctx.globalAlpha = 0.05 + 0.03 * motion
    ctx.drawImage(this.sprGray, this.x - ns / 2, this.y - ns / 2, ns, ns)
    const R = Math.min(window.innerWidth, window.innerHeight) * 0.28
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    const px = (bx - cx) / cx
    const py = (by - cy) / cy
    for (const p of this.parts) {
      const depth = [0.3, 0.55, 0.85][p.l]
      let x = p.x - px * 26 * depth
      let y = p.y - py * 26 * depth
      let s = p.r * (1 + motion * 0.25)
      const dx = x - bx
      const dy = y - by
      const d2 = dx * dx + dy * dy
      if (d2 < R * R) {
        const d = Math.sqrt(d2) || 1
        const f = 1 - d / R
        const push = f * f * (8 + 30 * motion) * depth
        x += (dx / d) * push
        y += (dy / d) * push
        s *= 1 + f * (0.35 + 0.55 * motion)
      }
      ctx.globalAlpha = p.a * (0.72 + 0.28 * Math.sin(clock * p.tw + p.ph))
      const half = s * 9
      const spr = p.c === 0 ? this.sprCyan : p.c === 1 ? this.sprViolet : this.sprGray
      ctx.drawImage(spr, x - half, y - half, half * 2, half * 2)
    }
    ctx.restore()
  }
}
