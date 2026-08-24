import './style.css'
import { Input } from './input'
import { Game, MODES, RUN_LENGTH, fmtTime, type Phase } from './game'
import { Renderer } from './renderer'
import { SoundEngine } from './audio'

const canvas = document.getElementById('game') as HTMLCanvasElement
const hudLevel = document.getElementById('hud-level')!
const hudTime = document.getElementById('hud-time')!
const hudMult = document.getElementById('hud-mult')!
const hudFlash = document.getElementById('hud-flash')!
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
  modeList.appendChild(row)
  return row
})

function statsHTML(items: [string, string, string?][]): string {
  return items
    .map(
      ([label, value, cls]) =>
        `<div class="stat${cls ? ` ${cls}` : ''}"><b>${value}</b><span>${label}</span></div>`,
    )
    .join('')
}

let ovPhase: Phase | null = null
let ovMode = -1

function syncOverlay(): void {
  const p = game.phase
  const mi = p === 'ready' ? game.modeIndex : -1
  if (p === ovPhase && mi === ovMode) return
  ovPhase = p
  ovMode = mi

  if (p === 'playing' || p === 'preview') {
    overlay.classList.add('hidden')
    return
  }
  overlay.classList.remove('hidden')
  statsGrid.classList.add('hidden')
  modeList.classList.add('hidden')

  if (p === 'ready') {
    ovKicker.textContent = ''
    overlayTitle.textContent = game.messageTitle
    overlayTitle.className = 'title-default'
    overlaySub.textContent = game.messageSub
    modeList.classList.remove('hidden')
    modeRows.forEach((row, i) => {
      row.classList.toggle('sel', i === game.modeIndex)
      row.querySelector('em')!.textContent =
        i === game.modeIndex && game.recordRun(MODES[i].id) !== null
          ? `×${MODES[i].mult} · ${game.recordRun(MODES[i].id)!.toLocaleString('fr-FR')} pts`
          : `×${MODES[i].mult}`
    })
    ovHint.textContent =
      (input.connected ? '' : 'Manette non détectée — clavier OK · ') +
      '◀ ▶ mode · Ⓐ ou Entrée pour lancer'
  } else if (p === 'paused') {
    ovKicker.textContent = ''
    overlayTitle.textContent = game.messageTitle
    overlayTitle.className = 'title-default'
    overlaySub.textContent = game.messageSub
    ovHint.textContent = 'Ⓐ / Start — reprendre'
  } else if (p === 'transition' && game.lastSummary !== null) {
    const s = game.lastSummary
    ovKicker.textContent = `NIVEAU ${game.level + 1}/${RUN_LENGTH} · ${game.mode.name} ×${game.mode.mult}`
    overlayTitle.textContent =
      s.rankName === '—' ? `NIVEAU ${game.level + 1} TERMINÉ` : s.rankName
    overlayTitle.className = s.rankCls
    overlaySub.textContent =
      `Parcours +${s.pathPts.toLocaleString('fr-FR')} · Temps ${s.timePts >= 0 ? '+' : ''}${s.timePts} · Carto +${s.cartoPts} · Impacts -${s.impactPen}` +
      `\n+${s.points.toLocaleString('fr-FR')} pts (multiplicateur ×${game.mode.mult} inclus)`
    statsGrid.innerHTML = statsHTML([
      ['Temps', fmtTime(s.time)],
      ['Vitesse max', `${s.maxSpeedU.toFixed(1)} u/s`, 'violet'],
      ['Combo max', `${s.maxChain} cases`, 'violet'],
      ['Distance', `${s.distCells} cases`],
      [
        'Murs touchés',
        `${s.impacts}${s.impactsKnown > 0 ? ` (${s.impactsKnown})` : ''}`,
        s.impacts > 0 ? 'rose' : '',
      ],
      ['Murs palpés', `${s.probed}`, 'violet'],
      ['Éclairs', `${s.flashes}`],
      ['Points', `+${s.points.toLocaleString('fr-FR')}`, 'gold'],
    ])
    statsGrid.classList.remove('hidden')
    ovHint.textContent = 'Ⓐ continuer'
  } else if (p === 'recap') {
    ovKicker.textContent = `RUN ${game.mode.name} ×${game.mode.mult}`
    overlayTitle.textContent = game.messageTitle.replace('RUN TERMINÉ !', 'RUN TERMINÉ !')
    overlayTitle.className = 'title-default'
    overlaySub.textContent = game.messageSub
    const sumImpacts = game.runResults.reduce((a, r) => a + r.impacts, 0)
    const sumProbed = game.runResults.reduce((a, r) => a + r.probed, 0)
    const sumFlashes = game.runResults.reduce((a, r) => a + r.flashes, 0)
    statsGrid.innerHTML = statsHTML([
      ['Score total', game.totalScore.toLocaleString('fr-FR'), 'gold'],
      ['Temps total', fmtTime(game.totalTime)],
      ['Impacts', `${sumImpacts}`, sumImpacts > 0 ? 'rose' : ''],
      ['Murs palpés', `${sumProbed}`, 'violet'],
      ['Éclairs', `${sumFlashes}`],
      [
        'Éclairs payés',
        game.runFlashSpentPts > 0 ? `-${game.runFlashSpentPts.toLocaleString('fr-FR')}` : '0',
        game.runFlashSpentPts > 0 ? 'rose' : '',
      ],
    ])
    statsGrid.classList.remove('hidden')
    ovHint.textContent = 'Ⓐ nouveau run'
  }
}

const input = new Input()
const audio = new SoundEngine()
const game = new Game(input, audio)
const renderer = new Renderer(canvas)

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

  hudTime.textContent = fmtTime(game.totalTime)
  hudLevel.textContent = `NIVEAU ${game.level + 1}/${RUN_LENGTH} · ${game.gridSize}×${game.gridSize}`
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
  } else {
    hudFlash.textContent = ''
    hudFlash.className = ''
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
