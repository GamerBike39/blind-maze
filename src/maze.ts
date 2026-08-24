export interface Wall {
  x: number
  y: number
  w: number
  h: number
}

export interface Maze {
  cols: number
  rows: number
  ox: number
  oy: number
  cell: number
  th: number
  walls: Wall[]
  buckets: Map<number, number[]>
  start: [number, number]
  exit: [number, number]
  path: [number, number][]
}

function solve(
  hWalls: boolean[][],
  vWalls: boolean[][],
  cols: number,
  rows: number,
  start: [number, number],
  exit: [number, number],
): [number, number][] {
  const prev = new Map<number, number>()
  const seen = new Set<number>()
  const queue: [number, number][] = [[start[0], start[1]]]
  seen.add(start[1] * cols + start[0])
  let head = 0
  while (head < queue.length) {
    const [cx, cy] = queue[head++]
    const key = cy * cols + cx
    if (cx === exit[0] && cy === exit[1]) break
    if (cy > 0 && !hWalls[cy][cx] && !seen.has(key - cols)) {
      seen.add(key - cols)
      prev.set(key - cols, key)
      queue.push([cx, cy - 1])
    }
    if (cx < cols - 1 && !vWalls[cy][cx + 1] && !seen.has(key + 1)) {
      seen.add(key + 1)
      prev.set(key + 1, key)
      queue.push([cx + 1, cy])
    }
    if (cy < rows - 1 && !hWalls[cy + 1][cx] && !seen.has(key + cols)) {
      seen.add(key + cols)
      prev.set(key + cols, key)
      queue.push([cx, cy + 1])
    }
    if (cx > 0 && !vWalls[cy][cx] && !seen.has(key - 1)) {
      seen.add(key - 1)
      prev.set(key - 1, key)
      queue.push([cx - 1, cy])
    }
  }
  const path: [number, number][] = []
  let key = exit[1] * cols + exit[0]
  while (true) {
    path.push([key % cols, Math.floor(key / cols)])
    if (key === start[1] * cols + start[0]) break
    const p = prev.get(key)
    if (p === undefined) break
    key = p
  }
  path.reverse()
  return path
}

export type Rng = () => number

export function rngFromSeed(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function generateMaze(
  cols: number,
  rows: number,
  ox: number,
  oy: number,
  cell: number,
  th: number,
  rng: Rng = Math.random,
  braid = 0,
): Maze {
  const hWalls: boolean[][] = Array.from({ length: rows + 1 }, () => Array<boolean>(cols).fill(true))
  const vWalls: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols + 1).fill(true))
  const seen: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false))

  const stack: [number, number][] = [
    [Math.floor(rng() * cols), Math.floor(rng() * rows)],
  ]
  seen[stack[0][1]][stack[0][0]] = true

  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1]
    const neighbours: [number, number, number][] = []
    if (cy > 0 && !seen[cy - 1][cx]) neighbours.push([cx, cy - 1, 0])
    if (cx < cols - 1 && !seen[cy][cx + 1]) neighbours.push([cx + 1, cy, 1])
    if (cy < rows - 1 && !seen[cy + 1][cx]) neighbours.push([cx, cy + 1, 2])
    if (cx > 0 && !seen[cy][cx - 1]) neighbours.push([cx - 1, cy, 3])
    if (neighbours.length === 0) {
      stack.pop()
      continue
    }
    const [nx, ny, dir] = neighbours[Math.floor(rng() * neighbours.length)]
    if (dir === 0) hWalls[cy][cx] = false
    else if (dir === 1) vWalls[cy][cx + 1] = false
    else if (dir === 2) hWalls[cy + 1][cx] = false
    else vWalls[cy][cx] = false
    seen[ny][nx] = true
    stack.push([nx, ny])
  }

  if (braid > 0) {
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const deg =
          (hWalls[cy][cx] ? 0 : 1) +
          (vWalls[cy][cx + 1] ? 0 : 1) +
          (hWalls[cy + 1][cx] ? 0 : 1) +
          (vWalls[cy][cx] ? 0 : 1)
        if (deg !== 1 || rng() >= braid) continue
        const cand: (() => void)[] = []
        if (cy > 0 && hWalls[cy][cx]) cand.push(() => (hWalls[cy][cx] = false))
        if (cx < cols - 1 && vWalls[cy][cx + 1]) cand.push(() => (vWalls[cy][cx + 1] = false))
        if (cy < rows - 1 && hWalls[cy + 1][cx]) cand.push(() => (hWalls[cy + 1][cx] = false))
        if (cx > 0 && vWalls[cy][cx]) cand.push(() => (vWalls[cy][cx] = false))
        if (cand.length > 0) cand[Math.floor(rng() * cand.length)]()
      }
    }
  }

  const half = th / 2
  const walls: Wall[] = []
  for (let ry = 0; ry <= rows; ry++)
    for (let cx = 0; cx < cols; cx++)
      if (hWalls[ry][cx])
        walls.push({ x: ox + cx * cell - half, y: oy + ry * cell - half, w: cell + th, h: th })
  for (let ry = 0; ry < rows; ry++)
    for (let cx = 0; cx <= cols; cx++)
      if (vWalls[ry][cx])
        walls.push({ x: ox + cx * cell - half, y: oy + ry * cell - half, w: th, h: cell + th })

  const buckets = new Map<number, number[]>()
  walls.forEach((w, i) => {
    const c0 = clamp(Math.floor((w.x - ox) / cell), 0, cols - 1)
    const c1 = clamp(Math.floor((w.x + w.w - 0.01 - ox) / cell), 0, cols - 1)
    const r0 = clamp(Math.floor((w.y - oy) / cell), 0, rows - 1)
    const r1 = clamp(Math.floor((w.y + w.h - 0.01 - oy) / cell), 0, rows - 1)
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const key = r * cols + c
        const list = buckets.get(key)
        if (list) list.push(i)
        else buckets.set(key, [i])
      }
  })

  const corners: [number, number][] = [
    [0, 0],
    [cols - 1, 0],
    [cols - 1, rows - 1],
    [0, rows - 1],
  ]
  const s = Math.floor(rng() * 4)
  const start = corners[s]
  const exit = corners[(s + 2) % 4]

  return {
    cols,
    rows,
    ox,
    oy,
    cell,
    th,
    walls,
    buckets,
    start,
    exit,
    path: solve(hWalls, vWalls, cols, rows, start, exit),
  }
}

export function wallsNear(
  m: Maze,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  out: Set<number>,
): void {
  out.clear()
  const c0 = clamp(Math.floor((minX - m.ox) / m.cell), 0, m.cols - 1)
  const c1 = clamp(Math.floor((maxX - m.ox) / m.cell), 0, m.cols - 1)
  const r0 = clamp(Math.floor((minY - m.oy) / m.cell), 0, m.rows - 1)
  const r1 = clamp(Math.floor((maxY - m.oy) / m.cell), 0, m.rows - 1)
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const list = m.buckets.get(r * m.cols + c)
      if (list) for (const id of list) out.add(id)
    }
}

export function wallsAtPoint(m: Maze, x: number, y: number, out: number[]): number[] {
  out.length = 0
  const c = clamp(Math.floor((x - m.ox) / m.cell), 0, m.cols - 1)
  const r = clamp(Math.floor((y - m.oy) / m.cell), 0, m.rows - 1)
  const list = m.buckets.get(r * m.cols + c)
  if (list)
    for (const id of list) {
      const w = m.walls[id]
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) out.push(id)
    }
  return out
}
