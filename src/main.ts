import './style.css'
import { Input } from './input'
import { BOARD, Game, MODES, RUN_LENGTH, fmtTime, type Phase } from './game'
import { Renderer } from './renderer'
import { SoundEngine } from './audio'
import { Background } from './bg'

const canvas = document.getElementById('game') as HTMLCanvasElement
const hudLevel = document.getElementById('hud-level')!
const hudTime = document.getElementById('hud-time')!
const hudMult = document.getElementById('hud-mult')!
const hudFlash = document.getElementById('hud-flash')!
const hudSonar = document.getElementById('hud-sonar')!
const hudBest = document.getElementById('hud-best')!
const overlay = document.getElementById('overlay')!
const overlayTitle = document.getElementById('overlay-title')!
const overlaySub = document.getElementById('overlay-sub')!
const ovKicker = document.getElementById('ov-kicker')!
const ovHint = document.getElementById('ov-hint')!
const modeList = document.getElementById('mode-list')!
const statsGrid = document.getElementById('stats-grid')!

const modeRows = MODES.map((m) => {
  const row = document.createElement('div')
  row.className = 'mode-row'
  const name = document.createElement('span')
  name.textContent = m.name
  const mult = document.createElement('em')
  mult.textContent = `×${m.mult}`
  row.appendChild(name)
  row.appendChild(mult)
  row.addEventListener('click', (e) => {
    e.stopPropagation()
    game.modeIndex = MODES.indexOf(m)
  })
  modeList.appendChild(row)
  return row
})

const btnPause = document.getElementById('btn-pause')!
btnPause.addEventListener('click', () => game.togglePause())

const actSonar = document.getElementById('act-sonar')!
const actFlash = document.getElementById('act-flash')!
actSonar.addEventListener('click', () => game.fireSonar())
actFlash.addEventListener('click', () => game.useFlashPublic())

const btnReset = document.getElementById('btn-reset')!
btnReset.addEventListener('click', () => game.resetLevel())

const SETTINGS_KEY = 'labyrinthe-settings'
interface Settings {
  vol: number
  vib: boolean
  trail: number
}
const DEFAULTS: Settings = { vol: 85, vib: true, trail: 1 }
function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>
    return { ...DEFAULTS, ...s }
  } catch {
    return { ...DEFAULTS }
  }
}
function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {}
}

const modalEl = document.getElementById('modal')!
const modalContent = document.getElementById('modal-content')!
let modalKind: 'settings' | 'controls' | null = null

const KEYBOARD_LINES: [string, string][] = [
  ['ZQSD / WASD', 'Rouler'],
  ['Flèches', 'Palper'],
  ['Espace', 'Sonar'],
  ['G', 'Éclair'],
  ['R', 'Recommencer le niveau'],
  ['Échap / P', 'Pause'],
  ['Entrée / Espace', 'Valider'],
  ['F', 'Plein écran'],
]

function settingsHTML(s: Settings): string {
  return `
    <h3>Paramètres</h3>
    <label class="row">
      <span>Volume</span>
      <input type="range" id="set-vol" min="0" max="100" value="${s.vol}" />
    </label>
    <label class="row">
      <input type="checkbox" id="set-vib" ${s.vib ? 'checked' : ''} />
      <span>Vibrations</span>
    </label>
    <label class="row">
      <span>Trainée</span>
      <select id="set-trail">
        <option value="0.6" ${s.trail === 0.6 ? 'selected' : ''}>Courte</option>
        <option value="1" ${s.trail === 1 ? 'selected' : ''}>Normale</option>
        <option value="1.7" ${s.trail === 1.7 ? 'selected' : ''}>Longue</option>
      </select>
    </label>
    <button id="set-wipe">Effacer records &amp; tops</button>`
}

function deviceBlockHTML(k: 'pad' | 'touch' | 'mouse'): string {
  const label = k === 'pad' ? 'Manette' : k === 'touch' ? 'Tactile' : 'Souris'
  const lines: [string, string][] =
    k === 'pad'
      ? [
          ['Stick gauche', 'Rouler'],
          ['Stick droit', 'Palper'],
          ['RB', 'Éclair'],
          ['Start', 'Pause'],
        ]
      : k === 'touch'
        ? [
            ['Moitié gauche', 'Rouler (pan 1:1)'],
            ['Moitié droite', 'Palper'],
            ['Tap court', 'Valider'],
            ['Bouton ⏸', 'Pause'],
          ]
        : [
            ['Clic sur la balle + glisser', 'Guider'],
            ['Double-clic', 'Éclair'],
            ['Clic droit maintenu', 'Palper'],
          ]
  return (
    `<div class="dev-tag">${label}</div>` +
    lines.map(([a, b]) => `<div class="ctrl-line"><b>${a}</b><span>${b}</span></div>`).join('')
  )
}

function controlsHTML(): string {
  return `
    <h3>Commandes</h3>
    ${deviceBlockHTML(game.controlKind())}
    <h4>Clavier</h4>
    <ul class="keys">
      ${KEYBOARD_LINES.map(([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join('')}
    </ul>`
}

function openModal(kind: 'settings' | 'controls'): void {
  modalKind = kind
  if (kind === 'settings') {
    modalContent.innerHTML = settingsHTML(loadSettings())
    const vol = modalContent.querySelector<HTMLInputElement>('#set-vol')!
    const vib = modalContent.querySelector<HTMLInputElement>('#set-vib')!
    const trail = modalContent.querySelector<HTMLSelectElement>('#set-trail')!
    const wipe = modalContent.querySelector<HTMLButtonElement>('#set-wipe')!
    const apply = (): void => {
      const s: Settings = {
        vol: Number(vol.value),
        vib: vib.checked,
        trail: Number(trail.value),
      }
      audio.setVolume(s.vol / 100)
      input.vibrationEnabled = s.vib
      game.trailUserMul = s.trail
      saveSettings(s)
    }
    vol.addEventListener('input', apply)
    vib.addEventListener('change', apply)
    trail.addEventListener('change', apply)
    wipe.addEventListener('click', () => {
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('labyrinthe-'))
          .forEach((k) => localStorage.removeItem(k))
      } catch {}
      wipe.textContent = 'Effacé !'
      setTimeout(() => (wipe.textContent = 'Effacer records & tops'), 1500)
    })
  } else {
    modalContent.innerHTML = controlsHTML()
  }
  modalEl.classList.add('open')
  input.uiModalOpen = true
  game.requestPause()
}

function closeModal(): void {
  modalKind = null
  modalEl.classList.remove('open')
  input.uiModalOpen = false
}

document.getElementById('btn-settings')!.addEventListener('click', () =>
  modalKind === 'settings' ? closeModal() : openModal('settings'),
)
document.getElementById('btn-controls')!.addEventListener('click', () =>
  modalKind === 'controls' ? closeModal() : openModal('controls'),
)
document.getElementById('modal-close')!.addEventListener('click', closeModal)
modalEl.addEventListener('click', (e) => {
  if (e.target === modalEl) closeModal()
})
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && modalKind !== null) closeModal()
})

overlay.addEventListener('click', () => {
  if (!overlay.classList.contains('hidden')) input.pressStart()
})

const sticksLayer = document.getElementById('sticks')!
const stickEls: Record<string, { base: HTMLDivElement; knob: HTMLDivElement } | null> = {
  move: null,
  probe: null,
}

function showStick(key: 'move' | 'probe', v: { ax: number; ay: number; kx: number; ky: number } | null): void {
  let s = stickEls[key]
  if (!v) {
    if (s) {
      s.base.style.display = 'none'
      s.knob.style.display = 'none'
    }
    return
  }
  if (!s) {
    const base = document.createElement('div')
    base.className = 'stick-base'
    const knob = document.createElement('div')
    knob.className = `stick-knob${key === 'probe' ? ' probe' : ''}`
    sticksLayer.append(base, knob)
    s = stickEls[key] = { base, knob }
  }
  const dx = v.kx - v.ax
  const dy = v.ky - v.ay
  const d = Math.hypot(dx, dy)
  const f = d > 60 ? 60 / d : 1
  s.base.style.display = 'block'
  s.base.style.left = `${v.ax}px`
  s.base.style.top = `${v.ay}px`
  s.knob.style.display = 'block'
  s.knob.style.left = `${v.ax + dx * f}px`
  s.knob.style.top = `${v.ay + dy * f}px`
}

const ICONS: Record<string, string> = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gauge: '<path d="M5 15a7 7 0 0 1 14 0"/><path d="M12 15l4-5"/><circle cx="12" cy="15" r="1.6"/>',
  flame:
    '<path d="M12 3c1.2 2.8 4.5 4.2 4.5 8a4.5 4.5 0 0 1-9 0c0-1.8.8-3 1.8-4.6.4 1.4 1.2 2 2.2 2.6C11.2 7.6 11.6 5.4 12 3z"/>',
  route:
    '<path d="M4 20l6-6 4 4 6-10" stroke-dasharray="3 3"/><circle cx="4" cy="20" r="1.6"/><circle cx="20" cy="8" r="1.6"/>',
  wall:
    '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M3 14h18M9 5v5M15 10v4M6 14v5M18 14v5"/>',
  radar: '<path d="M12 13v6"/><path d="M8.8 9.8a4.5 4.5 0 0 1 6.4 0"/><path d="M6 7a8.5 8.5 0 0 1 12 0"/>',
  zap: '<path d="M13 2L5 13h5l-1.5 9L17 11h-5l1-9z"/>',
  star:
    '<path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2-5.6-3.2-5.6 3.2 1.3-6.2L3 9.5l6.3-.7z"/>',
  trophy:
    '<path d="M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4M12 15v4M8 19h8"/>',
  coins:
    '<rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M7 7V5h10v2"/>',
}

function icon(name?: string): string {
  if (!name) return ''
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
}

interface StatItem {
  label: string
  value: string
  icon?: string
  cls?: string
  anim?: number
  dec?: number
  pre?: string
  suf?: string
}

function statsHTML(items: StatItem[]): string {
  return items
    .map((it) => {
      const inner =
        it.anim !== undefined
          ? `${it.pre ?? ''}0${it.suf ?? ''}`
          : it.value
      const data =
        it.anim !== undefined
          ? ` data-anim="${it.anim}" data-dec="${it.dec ?? 0}" data-pre="${it.pre ?? ''}" data-suf="${it.suf ?? ''}"`
          : ''
      return `<div class="stat${it.cls ? ` ${it.cls}` : ''}">${icon(it.icon)}<b${data}>${inner}</b><span>${it.label}</span></div>`
    })
    .join('')
}

function animateStats(grid: HTMLElement): void {
  const els = Array.from(grid.querySelectorAll<HTMLElement>('b[data-anim]'))
  if (els.length === 0) return
  const t0 = performance.now()
  const DUR = 750
  const tick = (now: number): void => {
    const t = Math.min(1, (now - t0) / DUR)
    const e = 1 - Math.pow(1 - t, 3)
    for (const el of els) {
      const v = Number(el.dataset.anim)
      const dec = Number(el.dataset.dec ?? 0)
      el.textContent =
        (el.dataset.pre ?? '') +
        (v * e).toLocaleString('fr-FR', {
          minimumFractionDigits: dec,
          maximumFractionDigits: dec,
        }) +
        (el.dataset.suf ?? '')
    }
    if (t < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

let ovPhase: Phase | null = null
let ovMode = -1

function startWord(): string {
  return { pad: 'Ⓐ', touch: 'Tape', mouse: 'Clic' }[game.controlKind()]
}

function syncOverlay(): void {
  const p = game.phase
  const mi = p === 'ready' ? game.modeIndex : -1
  const kind = game.controlKind()
  if (p === ovPhase && mi === ovMode) return
  ovPhase = p
  ovMode = mi

  if (p === 'playing' || p === 'preview') {
    overlay.classList.add('hidden')
  } else {
    overlay.classList.remove('hidden')
  }
  btnPause.classList.toggle(
    'on',
    p === 'playing' || p === 'preview' || p === 'paused',
  )
  btnReset.classList.toggle(
    'on',
    p === 'playing' || p === 'preview' || p === 'paused',
  )
  document.getElementById('actions')!.classList.toggle(
    'on',
    kind === 'touch' && (p === 'playing' || p === 'preview' || p === 'paused'),
  )
  if (p === 'playing' || p === 'preview') return
  statsGrid.classList.add('hidden')
  modeList.classList.add('hidden')

  if (p === 'ready') {
    ovKicker.textContent = ''
    overlayTitle.textContent = game.messageTitle
    overlayTitle.className = 'title-default'
    const sel = MODES[game.modeIndex]
    const desc = sel.daily ? `${game.todayLabel()} — ${sel.desc}` : sel.desc
    overlaySub.textContent = `▸ ${desc}\n\n${game.messageSub}`
    modeList.classList.remove('hidden')
    modeRows.forEach((row, i) => {
      row.classList.toggle('sel', i === game.modeIndex)
      row.querySelector('em')!.textContent =
        i === game.modeIndex && game.recordRun(MODES[i].id) !== null
          ? `×${MODES[i].mult} · ${game.recordRun(MODES[i].id)!.toLocaleString('fr-FR')} pts`
          : `×${MODES[i].mult}`
    })
    ovHint.textContent = input.connected
      ? '◀ ▶ mode · Ⓐ pour lancer'
      : matchMedia('(pointer: coarse)').matches
        ? '◀ ▶ modes · tape l\u2019écran pour lancer\nMoitié gauche : rouler · moitié droite : palper'
        : 'Clic sur un mode · clic sur le panneau pour lancer\nEn jeu : clic sur la balle maintenu pour la guider'
  } else if (p === 'paused') {
    ovKicker.textContent = ''
    overlayTitle.textContent = game.messageTitle
    overlayTitle.className = 'title-default'
    overlaySub.textContent = game.messageSub
    ovHint.textContent = `${startWord()} pour reprendre`
  } else if (p === 'transition' && game.lastSummary !== null) {
    const s = game.lastSummary
    ovKicker.textContent =
      `NIVEAU ${game.level + 1}/${RUN_LENGTH} · ${game.mode.name} ×${game.mode.mult}` +
      (game.modifierLabel() ? ` · ⟬${game.modifierLabel()}⟭` : '')
    overlayTitle.textContent =
      s.rankName === '—' ? `NIVEAU ${game.level + 1} TERMINÉ` : s.rankName
    overlayTitle.className = s.rankCls
    overlaySub.textContent =
      `Parcours +${s.pathPts.toLocaleString('fr-FR')} · Temps ${s.timePts >= 0 ? '+' : ''}${s.timePts} · Carto +${s.cartoPts} · Impacts -${s.impactPen}` +
      `\n+${s.points.toLocaleString('fr-FR')} pts (multiplicateur ×${game.mode.mult} inclus)`
    statsGrid.innerHTML = statsHTML([
      { label: 'Temps', value: fmtTime(s.time), icon: 'clock' },
      {
        label: 'Vitesse max',
        value: `${s.maxSpeedU.toFixed(1)} u/s`,
        icon: 'gauge',
        cls: 'violet',
        anim: s.maxSpeedU,
        dec: 1,
        suf: ' u/s',
      },
      {
        label: 'Combo max',
        value: `${s.maxChain} cases`,
        icon: 'flame',
        cls: 'violet',
        anim: s.maxChain,
        suf: ' cases',
      },
      { label: 'Distance', value: `${s.distCells} cases`, icon: 'route', anim: s.distCells, suf: ' cases' },
      {
        label: 'Murs touchés',
        value: `${s.impacts}${s.impactsKnown > 0 ? ` (${s.impactsKnown})` : ''}`,
        icon: 'wall',
        cls: s.impacts > 0 ? 'rose' : '',
        anim: s.impacts,
      },
      { label: 'Murs palpés', value: `${s.probed}`, icon: 'radar', cls: 'violet', anim: s.probed },
      { label: 'Éclairs', value: `${s.flashes}`, icon: 'zap', anim: s.flashes },
      {
        label: 'Points',
        value: `+${s.points.toLocaleString('fr-FR')}`,
        icon: 'star',
        cls: 'gold',
        anim: s.points,
        pre: '+',
      },
    ])
    statsGrid.classList.remove('hidden')
    animateStats(statsGrid)
    ovHint.textContent = `${startWord()} pour continuer`
  } else if (p === 'recap') {
    ovKicker.textContent = `RUN ${game.mode.name} ×${game.mode.mult}`
    overlayTitle.textContent = game.messageTitle.replace('RUN TERMINÉ !', 'RUN TERMINÉ !')
    overlayTitle.className = 'title-default'
    overlaySub.textContent = game.messageSub
    const sumImpacts = game.runResults.reduce((a, r) => a + r.impacts, 0)
    const sumProbed = game.runResults.reduce((a, r) => a + r.probed, 0)
    const sumFlashes = game.runResults.reduce((a, r) => a + r.flashes, 0)
    statsGrid.innerHTML = statsHTML([
      {
        label: 'Score total',
        value: game.totalScore.toLocaleString('fr-FR'),
        icon: 'trophy',
        cls: 'gold',
        anim: game.totalScore,
      },
      { label: 'Temps total', value: fmtTime(game.totalTime), icon: 'clock' },
      {
        label: 'Impacts',
        value: `${sumImpacts}`,
        icon: 'wall',
        cls: sumImpacts > 0 ? 'rose' : '',
        anim: sumImpacts,
      },
      { label: 'Murs palpés', value: `${sumProbed}`, icon: 'radar', cls: 'violet', anim: sumProbed },
      { label: 'Éclairs', value: `${sumFlashes}`, icon: 'zap', anim: sumFlashes },
      {
        label: 'Éclairs payés',
        value:
          game.runFlashSpentPts > 0 ? `-${game.runFlashSpentPts.toLocaleString('fr-FR')}` : '0',
        icon: 'coins',
        cls: game.runFlashSpentPts > 0 ? 'rose' : '',
        anim: game.runFlashSpentPts,
        pre: '-',
      },
    ])
    statsGrid.classList.remove('hidden')
    animateStats(statsGrid)
    ovHint.textContent = `${startWord()} pour un nouveau run`
  }
}

const input = new Input()
const audio = new SoundEngine()
const game = new Game(input, audio)
const renderer = new Renderer(canvas)
const bg = new Background(document.getElementById('bg') as HTMLCanvasElement)

{
  const s = loadSettings()
  audio.setVolume(s.vol / 100)
  input.vibrationEnabled = s.vib
  game.trailUserMul = s.trail
}

let stageRect = document.getElementById('stage')!.getBoundingClientRect()
function refreshStageRect(): void {
  stageRect = document.getElementById('stage')!.getBoundingClientRect()
}
window.addEventListener('resize', refreshStageRect)
document.addEventListener('fullscreenchange', refreshStageRect)

window.addEventListener('keydown', () => audio.unlock())
window.addEventListener('pointerdown', () => audio.unlock())
window.addEventListener('gamepadconnected', () => audio.unlock())
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.requestPause()
})
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyF') return
  const el = document.getElementById('stage')
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  else void el?.requestFullscreen().catch(() => {})
})

let last = performance.now()
let shownScore = 0
let prevMult = 1

function frame(now: number): void {
  const dt = Math.min(0.033, Math.max(0, (now - last) / 1000))
  last = now

  input.poll()
  game.update(dt)
  renderer.draw(game, dt)
  const scale = stageRect.width / BOARD
  const bx = stageRect.left + game.ball.x * scale
  const by = stageRect.top + game.ball.y * scale
  bg.frame(bx, by, game.motion, dt, game.clock)
  input.setPointerView(stageRect.left, stageRect.top, scale)
  input.setBallPos(game.ball.x, game.ball.y, game.ball.r)
  const sv = input.uiSticks()
  showStick('move', sv.move)
  showStick('probe', sv.probe)

  hudTime.textContent = fmtTime(game.totalTime)
  const mt = game.modifierTag()
  hudLevel.textContent =
    `NIVEAU ${game.level + 1}/${RUN_LENGTH} · ${game.gridSize}×${game.gridSize}` +
    (mt ? ` · ⟬${mt}⟭` : '')
  shownScore += (game.totalScore + game.levelPoints - shownScore) * Math.min(1, dt * 7)
  if (Math.abs(game.totalScore + game.levelPoints - shownScore) < 1) {
    shownScore = game.totalScore + game.levelPoints
  }
  hudBest.textContent = `SCORE ${Math.round(shownScore).toLocaleString('fr-FR')}`
  if (game.phase === 'playing' || game.phase === 'preview' || game.phase === 'paused') {
    if (game.grenades > 0) {
      hudFlash.textContent = `⚡×${game.grenades}`
      hudFlash.className = ''
    } else {
      const cost = game.flashNextCost
      hudFlash.textContent = `⚡${cost}`
      hudFlash.className = game.totalScore >= cost ? 'paid' : 'broke'
    }
    hudSonar.textContent = `📡${game.sonarCharges}${game.sonarFill > 0 ? `·${game.sonarFill}` : ''}`
    hudSonar.className = game.sonarCharges > 0 ? '' : 'broke'
  } else {
    hudFlash.textContent = ''
    hudFlash.className = ''
    hudSonar.textContent = ''
    hudSonar.className = ''
  }
  if (game.mult > 1) {
    hudMult.textContent = `×${game.mult}`
    hudMult.classList.add('on')
    if (game.mult !== prevMult) {
      hudMult.classList.remove('bump')
      void hudMult.offsetWidth
      hudMult.classList.add('bump')
    }
  } else {
    hudMult.textContent = ''
    hudMult.classList.remove('on')
  }
  prevMult = game.mult

  syncOverlay()

  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
