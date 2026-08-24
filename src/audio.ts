export class SoundEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private rollGain: GainNode | null = null
  private rollFilter: BiquadFilterNode | null = null
  private probeGain: GainNode | null = null
  private comboGain: GainNode | null = null
  private comboFilter: BiquadFilterNode | null = null
  private comboOscA: OscillatorNode | null = null
  private comboOscB: OscillatorNode | null = null
  private nearGain: GainNode | null = null
  private volume = 0.85

  setVolume(v01: number): void {
    this.volume = Math.max(0, Math.min(1, v01)) * 0.9
    if (this.master) this.master.gain.value = this.volume
  }

  unlock(): void {
    try {
      if (!this.ctx) {
        const c = new AudioContext()
        this.ctx = c
        this.master = c.createGain()
        this.master.gain.value = this.volume
        this.master.connect(c.destination)
        const len = Math.floor(c.sampleRate * 0.7)
        const buf = c.createBuffer(1, len, c.sampleRate)
        const data = buf.getChannelData(0)
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
        this.noise = buf
        const rollSrc = c.createBufferSource()
        rollSrc.buffer = buf
        rollSrc.loop = true
        this.rollFilter = c.createBiquadFilter()
        this.rollFilter.type = 'lowpass'
        this.rollFilter.frequency.value = 260
        this.rollGain = c.createGain()
        this.rollGain.gain.value = 0
        rollSrc.connect(this.rollFilter)
        this.rollFilter.connect(this.rollGain)
        this.rollGain.connect(this.master)
        rollSrc.start()
        const probeSrc = c.createBufferSource()
        probeSrc.buffer = buf
        probeSrc.loop = true
        const bp = c.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 1500
        bp.Q.value = 1.6
        this.probeGain = c.createGain()
        this.probeGain.gain.value = 0
        probeSrc.connect(bp)
        bp.connect(this.probeGain)
        this.probeGain.connect(this.master)
        probeSrc.start()
        this.comboOscA = c.createOscillator()
        this.comboOscA.type = 'sawtooth'
        this.comboOscA.frequency.value = 55
        this.comboOscB = c.createOscillator()
        this.comboOscB.type = 'sawtooth'
        this.comboOscB.frequency.value = 55.4
        this.comboFilter = c.createBiquadFilter()
        this.comboFilter.type = 'lowpass'
        this.comboFilter.frequency.value = 300
        this.comboFilter.Q.value = 0.8
        this.comboGain = c.createGain()
        this.comboGain.gain.value = 0
        this.comboOscA.connect(this.comboFilter)
        this.comboOscB.connect(this.comboFilter)
        this.comboFilter.connect(this.comboGain)
        this.comboGain.connect(this.master)
        this.comboOscA.start()
        this.comboOscB.start()
        const nearOsc = c.createOscillator()
        nearOsc.type = 'sine'
        nearOsc.frequency.value = 220
        this.nearGain = c.createGain()
        this.nearGain.gain.value = 0
        nearOsc.connect(this.nearGain)
        this.nearGain.connect(this.master)
        nearOsc.start()
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      this.ctx = null
    }
  }

  impact(s: number): void {
    const c = this.ctx
    const master = this.master
    const noise = this.noise
    if (!c || !master || !noise || c.state !== 'running') return
    const t = c.currentTime
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(140 + 100 * s, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.15)
    const og = c.createGain()
    og.gain.setValueAtTime(0.001, t)
    og.gain.exponentialRampToValueAtTime(0.28 + 0.5 * s, t + 0.008)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.17)
    o.connect(og)
    og.connect(master)
    o.start(t)
    o.stop(t + 0.19)
    const n = c.createBufferSource()
    n.buffer = noise
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 650 + 1100 * s
    const ng = c.createGain()
    ng.gain.setValueAtTime(0.16 + 0.34 * s, t)
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    n.connect(f)
    f.connect(ng)
    ng.connect(master)
    n.start(t)
    n.stop(t + 0.08)
  }

  win(tier: number): void {
    const c = this.ctx
    const master = this.master
    if (!c || !master || c.state !== 'running') return
    const seqs: number[][][] = [
      [[330, 0], [262, 0.13]],
      [[392, 0], [493.88, 0.11], [587.33, 0.22]],
      [[440, 0], [554.37, 0.1], [659.25, 0.2], [880, 0.32]],
      [
        [523.25, 0],
        [659.25, 0.09],
        [783.99, 0.18],
        [1046.5, 0.27],
        [783.99, 0.42],
      ],
      [
        [523.25, 0],
        [659.25, 0.08],
        [783.99, 0.16],
        [1046.5, 0.24],
        [1318.5, 0.33],
        [1567.98, 0.44],
      ],
    ]
    const seq = seqs[Math.max(0, Math.min(4, tier))]
    seq.forEach(([freq, off], i) => {
      const t = c.currentTime + off
      const o = c.createOscillator()
      o.type = 'triangle'
      o.frequency.value = freq
      const g = c.createGain()
      g.gain.setValueAtTime(0.001, t)
      g.gain.exponentialRampToValueAtTime(0.16 + 0.05 * (tier / 4), t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.34)
      o.connect(g)
      g.connect(master)
      o.start(t)
      o.stop(t + 0.36)
      if (tier >= 4 && i >= 3) {
        const h = c.createOscillator()
        h.type = 'sine'
        h.frequency.value = freq * 2
        const hg = c.createGain()
        hg.gain.setValueAtTime(0.001, t)
        hg.gain.exponentialRampToValueAtTime(0.07, t + 0.01)
        hg.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
        h.connect(hg)
        hg.connect(master)
        h.start(t)
        h.stop(t + 0.52)
      }
    })
  }

  begin(): void {
    const c = this.ctx
    const master = this.master
    if (!c || !master || c.state !== 'running') return
    const notes = [392, 587.33]
    notes.forEach((freq, i) => {
      const t = c.currentTime + i * 0.09
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.value = freq
      const g = c.createGain()
      g.gain.setValueAtTime(0.001, t)
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
      o.connect(g)
      g.connect(master)
      o.start(t)
      o.stop(t + 0.22)
    })
  }

  setRoll(norm: number): void {
    const c = this.ctx
    const rg = this.rollGain
    const rf = this.rollFilter
    if (!c || !rg || !rf || c.state !== 'running') return
    const t = c.currentTime
    rg.gain.setTargetAtTime(norm * 0.05, t, 0.09)
    rf.frequency.setTargetAtTime(240 + 720 * norm, t, 0.09)
  }

  setProbe(on: boolean): void {
    const c = this.ctx
    const pg = this.probeGain
    if (!c || !pg || c.state !== 'running') return
    pg.gain.setTargetAtTime(on ? 0.045 : 0, c.currentTime, on ? 0.02 : 0.09)
  }

  setCombo(norm: number): void {
    const c = this.ctx
    const g = this.comboGain
    const f = this.comboFilter
    const oa = this.comboOscA
    const ob = this.comboOscB
    if (!c || !g || !f || !oa || !ob || c.state !== 'running') return
    const n = Math.max(0, Math.min(1, norm))
    const t = c.currentTime
    g.gain.setTargetAtTime(n * 0.04, t, 0.25)
    f.frequency.setTargetAtTime(300 + 1100 * n, t, 0.25)
    const base = 55 * Math.pow(2, n * 2.2)
    oa.frequency.setTargetAtTime(base, t, 0.25)
    ob.frequency.setTargetAtTime(base * 1.007, t, 0.25)
  }

  setNear(norm: number): void {
    const c = this.ctx
    const ng = this.nearGain
    if (!c || !ng || c.state !== 'running') return
    const n = Math.max(0, Math.min(1, norm))
    ng.gain.setTargetAtTime(n * n * 0.03, c.currentTime, 0.12)
  }

  ping(): void {
    const c = this.ctx
    const master = this.master
    if (!c || !master || c.state !== 'running') return
    const t = c.currentTime
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(760, t)
    o.frequency.exponentialRampToValueAtTime(180, t + 0.28)
    const g = c.createGain()
    g.gain.setValueAtTime(0.001, t)
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    const dl = c.createDelay(1)
    dl.delayTime.value = 0.13
    const fb = c.createGain()
    fb.gain.value = 0.38
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1200
    const eg = c.createGain()
    eg.gain.value = 0.5
    o.connect(g)
    g.connect(master)
    g.connect(dl)
    dl.connect(lp)
    lp.connect(fb)
    fb.connect(dl)
    lp.connect(eg)
    eg.connect(master)
    o.start(t)
    o.stop(t + 0.32)
  }

  flash(): void {
    const c = this.ctx
    const master = this.master
    const noise = this.noise
    if (!c || !master || !noise || c.state !== 'running') return
    const t = c.currentTime
    const n = c.createBufferSource()
    n.buffer = noise
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.2
    f.frequency.setValueAtTime(400, t)
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.3)
    const g = c.createGain()
    g.gain.setValueAtTime(0.001, t)
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.04)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38)
    n.connect(f)
    f.connect(g)
    g.connect(master)
    n.start(t)
    n.stop(t + 0.4)
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(880, t)
    o.frequency.exponentialRampToValueAtTime(220, t + 0.25)
    const og = c.createGain()
    og.gain.setValueAtTime(0.12, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    o.connect(og)
    og.connect(master)
    o.start(t)
    o.stop(t + 0.32)
  }
}
