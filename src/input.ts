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

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault()
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
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
    this.startFlag = edge || keyEdge
    this.pauseFlag = pauseEdge || pauseKeyEdge
    this.flashFlag = flashBtn || keyGEdge
    this.menuDirFlag = menuDir
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

  leftStick(): Stick {
    const gp = this.pad()
    if (gp) return stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0)
    return this.keyVec('KeyA', 'KeyD', 'KeyW', 'KeyS')
  }

  rightStick(): Stick {
    const gp = this.pad()
    if (gp) return stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0)
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
    if (!act) return
    act.playEffect('dual-rumble', {
      duration: ms,
      strongMagnitude: Math.min(1, Math.max(0, strong)),
      weakMagnitude: Math.min(1, Math.max(0, weak)),
    }).catch(() => {})
  }
}
