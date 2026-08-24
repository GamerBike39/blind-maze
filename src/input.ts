type RumbleOptions = {
  duration: number
  strongMagnitude: number
  weakMagnitude: number
}

type RumbleActuator = {
  playEffect(type: 'dual-rumble', options?: RumbleOptions): Promise<string>
}

type PadWithRumble = Gamepad & { vibrationActuator?: RumbleActuator }

export interface Stick {
  x: number
  y: number
  m: number
}

export interface StickView {
  ax: number
  ay: number
  kx: number
  ky: number
}

const DZ = 0.18
const TOUCH_RADIUS = 60
const MOUSE_PPU = 95
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'])

const ZERO: Stick = { x: 0, y: 0, m: 0 }

function shape(m: number): number {
  return m * m
}

function stick(ax: number, ay: number): Stick {
  const raw = Math.hypot(ax, ay)
  if (raw <= DZ) return ZERO
  const nm = Math.min(1, (raw - DZ) / (1 - DZ))
  const c = shape(nm)
  return { x: (ax / raw) * c, y: (ay / raw) * c, m: c }
}

interface TouchStick {
  id: number
  ax: number
  ay: number
  dx: number
  dy: number
}

export class Input {
  padIndex: number | null = null
  padId = ''
  private keys = new Set<string>()
  private prevKeys = new Set<string>()
  private prevButtons: boolean[] = []
  private startFlag = false
  private pauseFlag = false
  private flashFlag = false
  private menuDirFlag = 0
  private prevMenuLeft = false
  private prevMenuRight = false
  private prevKeyG = false

  private ptrX = window.innerWidth / 2
  private ptrY = window.innerHeight / 2
  private ptrT = -1e9
  private rmb = false
  private anchorX = 0
  private anchorY = 0

  private touchMove: TouchStick | null = null
  private touchProbe: TouchStick | null = null
  private tapAt = 0
  private tapX = 0
  private tapY = 0
  private tapIgnore = false
  private tapFlag = false

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault()
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.rmb = false
      this.touchMove = null
      this.touchProbe = null
    })
    window.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('pointermove', (e) => this.onMove(e))
    window.addEventListener('pointerdown', (e) => this.onDown(e))
    window.addEventListener('pointerup', (e) => this.onUp(e))
    window.addEventListener('pointercancel', (e) => this.onCancel(e))
    window.addEventListener('gamepadconnected', (e) => {
      this.padIndex = e.gamepad.index
      this.padId = e.gamepad.id
    })
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.padIndex === e.gamepad.index) {
        this.padIndex = null
        this.padId = ''
      }
    })
  }

  private onMove(e: PointerEvent): void {
    this.ptrX = e.clientX
    this.ptrY = e.clientY
    this.ptrT = performance.now()
    const mv = this.touchMove
    if (mv && e.pointerId === mv.id) {
      mv.dx = e.clientX - mv.ax
      mv.dy = e.clientY - mv.ay
    }
    const pr = this.touchProbe
    if (pr && e.pointerId === pr.id) {
      pr.dx = e.clientX - pr.ax
      pr.dy = e.clientY - pr.ay
    }
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      if (e.button === 2) this.rmb = true
      return
    }
    const overUi =
      e.target instanceof Element && !!e.target.closest('#overlay, #btn-pause')
    const half = window.innerWidth / 2
    if (!overUi) {
      if (e.clientX < half && !this.touchMove) {
        this.touchMove = { id: e.pointerId, ax: e.clientX, ay: e.clientY, dx: 0, dy: 0 }
      } else if (!this.touchProbe) {
        this.touchProbe = { id: e.pointerId, ax: e.clientX, ay: e.clientY, dx: 0, dy: 0 }
      }
    }
    this.tapAt = performance.now()
    this.tapX = e.clientX
    this.tapY = e.clientY
    this.tapIgnore = overUi
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      if (e.button === 2) this.rmb = false
      return
    }
    if (this.touchMove?.id === e.pointerId) this.touchMove = null
    if (this.touchProbe?.id === e.pointerId) this.touchProbe = null
    const dt = performance.now() - this.tapAt
    const dist = Math.hypot(e.clientX - this.tapX, e.clientY - this.tapY)
    if (!this.tapIgnore && dt < 260 && dist < 14) this.tapFlag = true
  }

  private onCancel(e: PointerEvent): void {
    if (this.touchMove?.id === e.pointerId) this.touchMove = null
    if (this.touchProbe?.id === e.pointerId) this.touchProbe = null
  }

  setPointerAnchor(x: number, y: number): void {
    this.anchorX = x
    this.anchorY = y
  }

  uiSticks(): { move: StickView | null; probe: StickView | null } {
    const view = (t: TouchStick | null): StickView | null =>
      t ? { ax: t.ax, ay: t.ay, kx: t.ax + t.dx, ky: t.ay + t.dy } : null
    return { move: view(this.touchMove), probe: view(this.touchProbe) }
  }

  poll(): void {
    const gp = this.pad()
    let edge = false
    let pauseEdge = false
    let flashBtn = false
    if (gp) {
      gp.buttons.forEach((b, i) => {
        const was = this.prevButtons[i] ?? false
        if (b.pressed && !was) {
          if (i === 0 || i === 9) edge = true
          if (i === 9) pauseEdge = true
          if (i === 5) flashBtn = true
        }
        this.prevButtons[i] = b.pressed
      })
    } else {
      this.prevButtons = []
    }
    const keyNow = this.keys.has('Enter') || this.keys.has('Space')
    const keyEdge = keyNow && !(this.prevKeys.has('Enter') || this.prevKeys.has('Space'))
    const pauseNow = this.keys.has('Escape') || this.keys.has('KeyP')
    const pauseKeyEdge = pauseNow && !(this.prevKeys.has('Escape') || this.prevKeys.has('KeyP'))
    const keyG = this.keys.has('KeyG')
    const keyGEdge = keyG && !this.prevKeyG
    this.prevKeyG = keyG
    const menuLeft = (gp?.buttons[14]?.pressed ?? false) || this.keys.has('ArrowLeft')
    const menuRight = (gp?.buttons[15]?.pressed ?? false) || this.keys.has('ArrowRight')
    let menuDir = 0
    if (menuLeft && !this.prevMenuLeft) menuDir -= 1
    if (menuRight && !this.prevMenuRight) menuDir += 1
    this.prevMenuLeft = menuLeft
    this.prevMenuRight = menuRight
    this.prevKeys = new Set(this.keys)
    this.startFlag = edge || keyEdge || this.tapFlag
    this.pauseFlag = pauseEdge || pauseKeyEdge
    this.flashFlag = flashBtn || keyGEdge
    this.menuDirFlag = menuDir
    this.tapFlag = false
  }

  menuDir(): number {
    const v = this.menuDirFlag
    this.menuDirFlag = 0
    return v
  }

  flashEdge(): boolean {
    const s = this.flashFlag
    this.flashFlag = false
    return s
  }

  startEdge(): boolean {
    const s = this.startFlag
    this.startFlag = false
    return s
  }

  pauseEdge(): boolean {
    const s = this.pauseFlag
    this.pauseFlag = false
    return s
  }

  private pad(): Gamepad | null {
    if (this.padIndex === null) return null
    return navigator.getGamepads()[this.padIndex] ?? null
  }

  get connected(): boolean {
    return this.pad() !== null
  }

  get vibrating(): boolean {
    return !!(this.pad() as PadWithRumble | null)?.vibrationActuator
  }

  private keysActive(): boolean {
    return (
      this.keys.has('KeyA') ||
      this.keys.has('KeyD') ||
      this.keys.has('KeyW') ||
      this.keys.has('KeyS') ||
      this.keys.has('ArrowLeft') ||
      this.keys.has('ArrowRight') ||
      this.keys.has('ArrowUp') ||
      this.keys.has('ArrowDown')
    )
  }

  leftStick(): Stick {
    const tm = this.touchMove
    if (tm) return stick(tm.dx / TOUCH_RADIUS, tm.dy / TOUCH_RADIUS)
    const gp = this.pad()
    if (gp) return stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0)
    const fresh = performance.now() - this.ptrT < 2000
    if (!this.keysActive() && fresh) {
      return stick((this.ptrX - this.anchorX) / MOUSE_PPU, (this.ptrY - this.anchorY) / MOUSE_PPU)
    }
    return this.keyVec('KeyA', 'KeyD', 'KeyW', 'KeyS')
  }

  rightStick(): Stick {
    const tp = this.touchProbe
    if (tp) return stick(tp.dx / TOUCH_RADIUS, tp.dy / TOUCH_RADIUS)
    const gp = this.pad()
    if (gp) return stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0)
    if (this.rmb) {
      const dx = this.ptrX - this.anchorX
      const dy = this.ptrY - this.anchorY
      const d = Math.hypot(dx, dy)
      if (d > 4) {
        const m = Math.min(1, d / (MOUSE_PPU * 0.7))
        return stick((dx / d) * m, (dy / d) * m)
      }
    }
    return this.keyVec('ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown')
  }

  private keyVec(l: string, r: string, u: string, d: string): Stick {
    const x = (this.keys.has(r) ? 1 : 0) - (this.keys.has(l) ? 1 : 0)
    const y = (this.keys.has(d) ? 1 : 0) - (this.keys.has(u) ? 1 : 0)
    return stick(x, y)
  }

  rumble(strong: number, weak: number, ms: number): void {
    const gp = this.pad() as PadWithRumble | null
    const act = gp?.vibrationActuator
    if (act) {
      act.playEffect('dual-rumble', {
        duration: ms,
        strongMagnitude: Math.min(1, Math.max(0, strong)),
        weakMagnitude: Math.min(1, Math.max(0, weak)),
      }).catch(() => {})
      return
    }
    try {
      navigator.vibrate(Math.round(ms * (0.35 + strong * 0.65)))
    } catch {}
  }
}
