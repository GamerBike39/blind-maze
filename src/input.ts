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

interface BoardPos {
  x: number
  y: number
}

const DZ = 0.18
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
  uiModalOpen = false
  private keys = new Set<string>()
  private prevKeys = new Set<string>()
  private prevButtons: boolean[] = []
  private startFlag = false
  private pauseFlag = false
  private flashFlag = false
  private resetFlag = false
  private menuDirFlag = 0
  private prevMenuLeft = false
  private prevMenuRight = false
  private prevKeyG = false
  private prevKeyR = false
  vibrationEnabled = true

  private ptrX = window.innerWidth / 2
  private ptrY = window.innerHeight / 2
  private rmb = false
  private grabbed = false
  private lastClickT = -1e9
  private lastClickX = 0
  private lastClickY = 0
  private dblFlag = false
  private viewL = 0
  private viewT = 0
  private viewScale = 1
  private ballBX = 0
  private ballBY = 0
  private ballR = 12

  private touchMove: TouchStick | null = null
  private touchProbe: TouchStick | null = null
  private tapAt = 0
  private tapX = 0
  private tapY = 0
  private tapIgnore = false
  private tapFlag = false
  private lastKeyT = -1e9

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault()
      this.keys.add(e.code)
      this.lastKeyT = performance.now()
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.rmb = false
      this.grabbed = false
      this.touchMove = null
      this.touchProbe = null
    })
    window.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return
      this.ptrX = e.clientX
      this.ptrY = e.clientY
    })
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

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) {
        const bsx = this.viewL + this.ballBX * this.viewScale
        const bsy = this.viewT + this.ballBY * this.viewScale
        const rad = Math.max(18, this.ballR * this.viewScale * 1.7)
        if (Math.hypot(e.clientX - bsx, e.clientY - bsy) <= rad) this.grabbed = true
        const now = performance.now()
        if (
          now - this.lastClickT < 350 &&
          Math.hypot(e.clientX - this.lastClickX, e.clientY - this.lastClickY) < 22
        ) {
          this.dblFlag = true
          this.lastClickT = -1e9
        } else {
          this.lastClickT = now
          this.lastClickX = e.clientX
          this.lastClickY = e.clientY
        }
      }
      if (e.button === 2) this.rmb = true
      return
    }
    const overUi =
      e.target instanceof Element && !!e.target.closest('#overlay, #btn-pause')
    const half = window.innerWidth / 2
    if (!overUi) {
      if (e.clientX < half && !this.touchMove) {
        this.touchMove = {
          id: e.pointerId,
          ax: e.clientX,
          ay: e.clientY,
          dx: 0,
          dy: 0,
        }
      } else if (!this.touchProbe) {
        this.touchProbe = {
          id: e.pointerId,
          ax: e.clientX,
          ay: e.clientY,
          dx: 0,
          dy: 0,
        }
      }
    }
    this.tapAt = performance.now()
    this.tapX = e.clientX
    this.tapY = e.clientY
    this.tapIgnore = overUi
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) {
        this.grabbed = false
      }
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

  setPointerView(left: number, top: number, scale: number): void {
    this.viewL = left
    this.viewT = top
    this.viewScale = scale
  }

  setBallPos(x: number, y: number, r: number = 12): void {
    this.ballBX = x
    this.ballBY = y
    this.ballR = r
  }

  private ptrBoard(): BoardPos {
    return {
      x: (this.ptrX - this.viewL) / this.viewScale,
      y: (this.ptrY - this.viewT) / this.viewScale,
    }
  }

  directMove(): BoardPos | null {
    const tm = this.touchMove
    if (tm) {
      return {
        x: this.ballBX + tm.dx / this.viewScale,
        y: this.ballBY + tm.dy / this.viewScale,
      }
    }
    if (this.grabbed) return this.ptrBoard()
    return null
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
    const keyR = this.keys.has('KeyR')
    const resetEdge = keyR && !this.prevKeyR
    this.prevKeyR = keyR
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
    this.flashFlag = flashBtn || keyGEdge || this.dblFlag
    this.resetFlag = resetEdge
    this.menuDirFlag = menuDir
    if (this.uiModalOpen) {
      this.startFlag = false
      this.pauseFlag = false
      this.flashFlag = false
      this.resetFlag = false
      this.menuDirFlag = 0
    }
    this.tapFlag = false
    this.dblFlag = false
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

  resetEdge(): boolean {
    const s = this.resetFlag
    this.resetFlag = false
    return s
  }

  private pad(): Gamepad | null {
    if (this.padIndex === null) return null
    return navigator.getGamepads()[this.padIndex] ?? null
  }

  get connected(): boolean {
    return this.pad() !== null
  }

  get kind(): 'pad' | 'touch' | 'mouse' {
    if (this.pad()) return 'pad'
    try {
      if (matchMedia('(pointer: coarse)').matches) return 'touch'
    } catch {}
    return 'mouse'
  }

  promptStart(): string {
    const now = performance.now()
    if (this.pad()) return 'Ⓐ POUR PARTIR'
    if (now - this.lastKeyT < 4000) return 'ENTRÉE POUR PARTIR'
    return this.kind === 'touch' ? 'TAPE POUR PARTIR' : 'CLIC POUR PARTIR'
  }

  pressStart(): void {
    this.startFlag = true
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
    if (this.touchMove) return ZERO
    const gp = this.pad()
    if (gp) return stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0)
    if (this.keysActive()) return this.keyVec('KeyA', 'KeyD', 'KeyW', 'KeyS')
    return ZERO
  }

  rightStick(): Stick {
    const tp = this.touchProbe
    if (tp) {
      const fx = (tp.ax + tp.dx - this.viewL) / this.viewScale
      const fy = (tp.ay + tp.dy - this.viewT) / this.viewScale
      const dx = fx - this.ballBX
      const dy = fy - this.ballBY
      const d = Math.hypot(dx, dy)
      if (d > 6) {
        const mag = Math.min(1, d / 55)
        return stick((dx / d) * mag, (dy / d) * mag)
      }
      return ZERO
    }
    const gp = this.pad()
    if (gp) return stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0)
    if (this.rmb) {
      const p = this.ptrBoard()
      const dx = p.x - this.ballBX
      const dy = p.y - this.ballBY
      const d = Math.hypot(dx, dy)
      if (d > 6) {
        const mag = Math.min(1, d / 55)
        return stick((dx / d) * mag, (dy / d) * mag)
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
    if (!this.vibrationEnabled) return
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
