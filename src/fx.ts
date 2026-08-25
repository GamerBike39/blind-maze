import { BOARD, type Game } from './game'

const MAX_WAVES = 10
const WAVE_SPEED = 0.52

export type Rgb = [number, number, number]

export const ROSE: Rgb = [1.0, 0.45, 0.55]
const CYAN: Rgb = [0.4, 0.95, 1.0]
const VIOLET: Rgb = [0.78, 0.6, 1.0]
const GOLD: Rgb = [1.0, 0.83, 0.3]
const ORANGE: Rgb = [1.0, 0.6, 0.25]
const MAGENTA: Rgb = [0.95, 0.4, 1.0]

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAG_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uThresh;
out vec4 o;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThresh, uThresh + 0.38, l);
  o = vec4(c * k, 1.0);
}`

const FRAG_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 o;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227027;
  c += texture(uTex, vUv + uDir * 1.3846).rgb * 0.316216;
  c += texture(uTex, vUv - uDir * 1.3846).rgb * 0.316216;
  c += texture(uTex, vUv + uDir * 3.2308).rgb * 0.070270;
  c += texture(uTex, vUv - uDir * 3.2308).rgb * 0.070270;
  o = vec4(c, 1.0);
}`

const FRAG_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloomTight;
uniform sampler2D uBloomWide;
uniform float uTime;
uniform float uCA;
uniform float uZoom;
uniform vec2 uCenter;
uniform float uBloom;
uniform float uFlash;
uniform vec3 uAddCol;
uniform float uAddAmt;
uniform vec3 uTint;
uniform float uGrain;
uniform int uWaveCount;
uniform vec4 uWaves[${MAX_WAVES}];
uniform vec3 uWaveCol[${MAX_WAVES}];
uniform float uWaveSpd[${MAX_WAVES}];
out vec4 o;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = uCenter + (vUv - uCenter) / uZoom;
  float caBoost = 0.0;
  vec3 ring = vec3(0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= uWaveCount) break;
    vec4 w = uWaves[i];
    float age = uTime - w.z;
    if (age < 0.0 || age > 2.5) continue;
    vec2 d = uv - w.xy;
    float dist = length(d);
    float R = age * ${WAVE_SPEED} * uWaveSpd[i];
    float sigma = 0.05 + age * 0.085;
    float x = (dist - R) / sigma;
    float band = exp(-x * x);
    float env = exp(-age * 2.4) * w.w;
    if (dist > 1e-4 && env > 0.001) {
      uv -= (d / dist) * band * env * 0.028;
    }
    caBoost += band * env;
    ring += uWaveCol[i] * band * env * 0.30;
  }

  vec2 cuv = uv - 0.5;
  float r2 = dot(cuv, cuv);
  float ca = (uCA + caBoost * 2.2) * (0.004 + 0.028 * r2);
  vec3 col;
  col.r = texture(uScene, uv + cuv * ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - cuv * ca).b;

  vec3 bl = texture(uBloomTight, uv).rgb * 0.75 + texture(uBloomWide, uv).rgb * 1.15;
  col += bl * uBloom;
  col += ring;

  col *= uTint;
  col += uAddCol * uAddAmt;

  col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0) * 0.85);

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, 1.09);
  col = vec3(1.0) - exp(-col * 1.35);

  float vig = smoothstep(1.05, 0.32, length(cuv) * 1.55);
  col *= mix(1.0, vig, 0.62);

  col += (hash(gl_FragCoord.xy + fract(uTime) * 271.3) - 0.5) * uGrain;

  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

interface Wave {
  x: number
  y: number
  t0: number
  amp: number
  spd: number
  col: Rgb
}

interface Rt {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

export class FxLayer {
  static create(stage: HTMLElement, source: HTMLCanvasElement): FxLayer | null {
    try {
      const canvas = document.createElement('canvas')
      canvas.id = 'fx'
      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
      })
      if (!gl) return null
      return new FxLayer(canvas, gl, stage, source)
    } catch {
      return null
    }
  }

  enabled = true

  private canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private source: HTMLCanvasElement
  private scratch: HTMLCanvasElement
  private sctx: CanvasRenderingContext2D

  private progBright: WebGLProgram | null
  private progBlur: WebGLProgram | null
  private progComp: WebGLProgram | null
  private uni = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  private texScene: WebGLTexture
  private rtA: Rt | null = null
  private rtB: Rt | null = null
  private rtC: Rt | null = null
  private W = 0
  private H = 0

  private waves: Wave[] = []
  private punchAmt = 0
  private punchX = 0.5
  private punchY = 0.5
  private flashAmt = 0
  private bloomPulse = 0
  private caSpike = 0
  private addAmt = 0
  private addCol: Rgb = [1, 1, 1]
  private tint: Rgb = [1, 1, 1]
  private tintTarget: Rgb = [1, 1, 1]

  private prevFlashAt = -10
  private prevSonarCharges = -1
  private prevPhase: Game['phase'] = 'ready'
  private prevInArena = false
  private prevShields = 99

  private reduced: boolean
  private dead = false
  private timeBase = performance.now()

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    private stage: HTMLElement,
    source: HTMLCanvasElement,
  ) {
    this.canvas = canvas
    this.gl = gl
    this.source = source
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

    this.scratch = document.createElement('canvas')
    const sctx = this.scratch.getContext('2d')
    if (!sctx) throw new Error('scratch 2d')
    this.sctx = sctx

    this.progBright = this.build(VERT, FRAG_BRIGHT)
    this.progBlur = this.build(VERT, FRAG_BLUR)
    this.progComp = this.build(VERT, FRAG_COMPOSITE)
    if (!this.progBright || !this.progBlur || !this.progComp) throw new Error('shader')

    this.texScene = this.makeTex()
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.dead = true
      this.applyEnabled()
    })

    stage.appendChild(canvas)
    this.syncSize()

    window.addEventListener('resize', () => this.syncSize())
    document.addEventListener('fullscreenchange', () => this.syncSize())
    this.applyEnabled()
  }

  setEnabled(v: boolean): void {
    this.enabled = v
    this.applyEnabled()
  }

  private applyEnabled(): void {
    const active = this.enabled && !this.dead && this.W > 0
    this.canvas.style.display = active ? 'block' : 'none'
    this.source.style.visibility = active ? 'hidden' : 'visible'
  }

  syncSize(): void {
    if (this.dead) return
    const rect = this.stage.getBoundingClientRect()
    const css = Math.max(120, Math.round(rect.width))
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let px = Math.min(1680, Math.round(css * dpr))
    px = Math.max(px & ~1, 120)
    if (px === this.W) return
    const gl = this.gl
    this.W = px
    this.H = px
    this.canvas.width = px
    this.canvas.height = px
    this.scratch.width = px
    this.scratch.height = px
    for (const rt of [this.rtA, this.rtB, this.rtC]) {
      if (rt) {
        gl.deleteTexture(rt.tex)
        gl.deleteFramebuffer(rt.fbo)
      }
    }
    const q = Math.max(60, Math.floor(px / 3))
    this.rtA = this.makeRt(q, q)
    this.rtB = this.makeRt(q, q)
    this.rtC = this.makeRt(q, q)
    this.applyEnabled()
  }

  shock(x: number, y: number, amp: number, col: Rgb, spd = 1): void {
    if (this.reduced) amp *= 0.6
    this.waves.push({ x, y, t0: this.now(), amp, spd, col })
    if (this.waves.length > MAX_WAVES * 2) this.waves.splice(0, this.waves.length - MAX_WAVES)
  }

  punch(x: number, y: number, amount: number): void {
    if (amount <= this.punchAmt) return
    this.punchAmt = amount
    this.punchX = x
    this.punchY = y
  }

  whiteout(a: number): void {
    this.flashAmt = Math.max(this.flashAmt, a)
  }

  surge(a: number): void {
    this.bloomPulse = Math.max(this.bloomPulse, a)
  }

  addGlow(col: Rgb, a: number): void {
    if (a <= this.addAmt) return
    this.addAmt = a
    this.addCol = col
  }

  update(g: Game): void {
    if (!this.enabled || this.dead) return

    if (g.flashAt !== this.prevFlashAt && g.flashAt >= 0) {
      this.shock(g.ball.x / BOARD, g.ball.y / BOARD, 1.5, VIOLET, 1.35)
      this.caSpike = Math.max(this.caSpike, 1.1)
      this.surge(0.9)
    }
    this.prevFlashAt = g.flashAt

    if (
      g.phase === 'playing' &&
      !g.inArena &&
      this.prevSonarCharges >= 0 &&
      g.sonarCharges === this.prevSonarCharges - 1 &&
      g.clock - g.flashAt > 0.05
    ) {
      this.shock(g.ball.x / BOARD, g.ball.y / BOARD, 1.25, CYAN, 1.1)
      this.surge(0.55)
    }
    this.prevSonarCharges = g.sonarCharges

    if (g.phase === 'transition' && this.prevPhase === 'playing') {
      const [ex, ey] = g.cellCenter(g.maze.exit)
      const ux = ex / BOARD
      const uy = ey / BOARD
      this.shock(ux, uy, 2.1, GOLD, 1.5)
      this.shock(ux, uy, 1.5, GOLD, 1.15)
      this.shock(g.ball.x / BOARD, g.ball.y / BOARD, 1.2, GOLD, 1.7)
      this.whiteout(0.55)
      this.surge(1.6)
      this.addGlow(GOLD, 0.16)
      this.caSpike = Math.max(this.caSpike, 1.4)
    }
    this.prevPhase = g.phase

    if (g.inArena && !this.prevInArena) {
      const orange = g.portalKind === 'chargeur'
      this.shock(0.5, 0.5, 1.9, orange ? ORANGE : MAGENTA, 1.25)
      this.whiteout(0.3)
      this.surge(1.1)
      this.tintTarget = orange ? [1.06, 0.9, 0.97] : [1.05, 0.92, 1.1]
      this.prevShields = g.arena?.shields ?? 99
    } else if (!g.inArena && this.prevInArena) {
      this.tintTarget = [1, 1, 1]
      if (this.enabled && !this.dead) {
        if (g.portalConsumed) {
          this.shock(0.5, 0.5, 2.2, GOLD, 1.4)
          this.whiteout(0.5)
          this.surge(1.7)
          this.addGlow(GOLD, 0.2)
        } else {
          this.shock(g.ball.x / BOARD, g.ball.y / BOARD, 1.3, ROSE, 1.2)
          this.caSpike = Math.max(this.caSpike, 1.0)
        }
      }
    }
    if (g.inArena && g.arena) {
      const A = g.arena
      if (A.shields < this.prevShields) {
        this.shock(
          A.bx / BOARD,
          A.by / BOARD,
          1.35,
          g.portalKind === 'chargeur' ? ORANGE : MAGENTA,
          1.3,
        )
        this.caSpike = Math.max(this.caSpike, 1.2)
        this.surge(0.8)
      }
      this.prevShields = A.shields
    }
    this.prevInArena = g.inArena

    for (let i = 0; i < 3; i++) {
      this.tint[i] += (this.tintTarget[i] - this.tint[i]) * 0.08
    }
  }

  render(dt: number): void {
    if (!this.enabled || this.dead || this.W === 0) return
    const gl = this.gl
    const progBright = this.progBright!
    const progBlur = this.progBlur!
    const progComp = this.progComp!
    const rtA = this.rtA!
    const rtB = this.rtB!
    const rtC = this.rtC!
    const now = this.now()

    this.waves = this.waves.filter((w) => now - w.t0 < 2.5)

    this.sctx.drawImage(this.source, 0, 0, this.W, this.H)

    gl.bindTexture(gl.TEXTURE_2D, this.texScene)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.scratch)

    const q = rtA.w
    gl.useProgram(progBright)
    gl.bindFramebuffer(gl.FRAMEBUFFER, rtA.fbo)
    gl.viewport(0, 0, q, q)
    this.use(progBright, 'uTex', this.texScene, 0)
    this.set(progBright, 'uThresh', 0.3)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    this.blurPass(progBlur, rtA, rtB, 1.6 / q, 0)
    this.blurPass(progBlur, rtB, rtA, 0, 1.6 / q)
    this.blurPass(progBlur, rtA, rtB, 3.4 / q, 0)
    this.blurPass(progBlur, rtB, rtC, 0, 3.4 / q)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.W, this.H)

    const d = Math.max(1e-4, Math.min(0.05, dt))
    this.punchAmt *= Math.exp(-9 * d)
    this.flashAmt *= Math.exp(-7 * d)
    this.bloomPulse *= Math.exp(-2.6 * d)
    this.caSpike *= Math.exp(-4.5 * d)
    this.addAmt *= Math.exp(-3.2 * d)

    const waveN = Math.min(MAX_WAVES, this.waves.length)
    const waveData = new Float32Array(MAX_WAVES * 4)
    const waveCols = new Float32Array(MAX_WAVES * 3)
    const waveSpds = new Float32Array(MAX_WAVES)
    for (let i = 0; i < waveN; i++) {
      const w = this.waves[this.waves.length - 1 - i]
      waveData[i * 4] = w.x
      waveData[i * 4 + 1] = 1 - w.y
      waveData[i * 4 + 2] = w.t0
      waveData[i * 4 + 3] = w.amp
      waveCols[i * 3] = w.col[0]
      waveCols[i * 3 + 1] = w.col[1]
      waveCols[i * 3 + 2] = w.col[2]
      waveSpds[i] = w.spd
    }
    const t = now

    gl.useProgram(progComp)
    this.use(progComp, 'uScene', this.texScene, 0)
    this.use(progComp, 'uBloomTight', rtA.tex, 1)
    this.use(progComp, 'uBloomWide', rtC.tex, 2)
    this.set(progComp, 'uTime', t)
    this.set(progComp, 'uCA', 0.35 + this.caSpike * 3.2)
    this.set(progComp, 'uZoom', 1 + this.punchAmt)
    this.set(progComp, 'uCenter', this.punchX, 1 - this.punchY)
    this.set(progComp, 'uBloom', 0.85 + this.bloomPulse)
    this.set(progComp, 'uFlash', this.flashAmt)
    this.set(progComp, 'uAddCol', this.addCol[0], this.addCol[1], this.addCol[2])
    this.set(progComp, 'uAddAmt', this.addAmt)
    this.set(progComp, 'uTint', this.tint[0], this.tint[1], this.tint[2])
    this.set(progComp, 'uGrain', this.reduced ? 0 : 0.034)
    this.setInt(progComp, 'uWaveCount', waveN)
    this.setArr(progComp, 'uWaves', waveData, 4)
    this.setArr(progComp, 'uWaveCol', waveCols, 3)
    this.setArr(progComp, 'uWaveSpd', waveSpds, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private blurPass(p: WebGLProgram, from: Rt, to: Rt, dx: number, dy: number): void {
    const gl = this.gl
    gl.useProgram(p)
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo)
    gl.viewport(0, 0, to.w, to.h)
    this.use(p, 'uTex', from.tex, 0)
    this.set(p, 'uDir', dx, dy)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private now(): number {
    return (performance.now() - this.timeBase) / 1000
  }

  private build(vsSrc: string, fsSrc: string): WebGLProgram | null {
    const gl = this.gl
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type)
      if (!sh) return null
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(sh))
        gl.deleteShader(sh)
        return null
      }
      return sh
    }
    const vs = compile(gl.VERTEX_SHADER, vsSrc)
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc)
    if (!vs || !fs) return null
    const p = gl.createProgram()
    if (!p) return null
    gl.attachShader(p, vs)
    gl.attachShader(p, fs)
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p))
      return null
    }
    this.uni.set(p, new Map())
    return p
  }

  private loc(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.uni.get(p)!
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name))
    return m.get(name)!
  }

  private use(p: WebGLProgram, name: string, tex: WebGLTexture, unit: number): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(this.loc(p, name), unit)
  }

  private set(p: WebGLProgram, name: string, x: number, y?: number, z?: number): void {
    const l = this.loc(p, name)
    if (!l) return
    if (z !== undefined) this.gl.uniform3f(l, x, y!, z)
    else if (y !== undefined) this.gl.uniform2f(l, x, y)
    else this.gl.uniform1f(l, x)
  }

  private setInt(p: WebGLProgram, name: string, value: number): void {
    const l = this.loc(p, name)
    if (!l) return
    this.gl.uniform1i(l, value)
  }

  private setArr(p: WebGLProgram, name: string, data: Float32Array, size: 1 | 3 | 4): void {
    const l = this.loc(p, name)
    if (!l) return
    if (size === 4) this.gl.uniform4fv(l, data)
    else if (size === 3) this.gl.uniform3fv(l, data)
    else this.gl.uniform1fv(l, data)
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()
    if (!t) throw new Error('tex')
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  private makeRt(w: number, h: number): Rt {
    const gl = this.gl
    const tex = this.makeTex()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()
    if (!fbo) throw new Error('fbo')
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex, fbo, w, h }
  }
}
