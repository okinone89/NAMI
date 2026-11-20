import type { DiagramBox } from "./diagram-layout"
import type { DiagramPosition as Point } from "./plans"

export type Segment = { a: Point; b: Point }
export const laneSpacing = 16
const clearance = 14
const center = (b: DiagramBox) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
})
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
const coord = (p: Point) => `${p.x} ${p.y}`

function ports(box: DiagramBox, lane: number) {
  const c = center(box)
  const x = c.x + lane * box.width * 0.36
  const y = c.y + lane * box.height * 0.36
  return [
    { x: box.x, y },
    { x: box.x + box.width, y },
    { x, y: box.y },
    { x, y: box.y + box.height },
  ]
}

function loopRoute(box: DiagramBox, lane: number) {
  const [, right, , bottom] = ports(box, lane)
  const gap = 26 + 12 * lane
  return [
    right,
    { x: right.x + gap, y: right.y },
    { x: right.x + gap, y: bottom.y + gap },
    { x: bottom.x, y: bottom.y + gap },
    bottom,
  ]
}

function blocked(a: Point, b: Point, boxes: DiagramBox[]) {
  return boxes.some((box) =>
    a.x === b.x
      ? a.x > box.x &&
        a.x < box.x + box.width &&
        Math.min(a.y, b.y) < box.y + box.height &&
        Math.max(a.y, b.y) > box.y
      : a.y > box.y &&
        a.y < box.y + box.height &&
        Math.min(a.x, b.x) < box.x + box.width &&
        Math.max(a.x, b.x) > box.x
  )
}

function simplify(points: Point[]) {
  const path: Point[] = []
  for (const p of points) {
    const last = path.at(-1),
      prev = path.at(-2)
    if (last && last.x === p.x && last.y === p.y) continue
    if (
      prev &&
      last &&
      ((prev.x === last.x && last.x === p.x) ||
        (prev.y === last.y && last.y === p.y))
    )
      path.pop()
    path.push(p)
  }
  return path
}

// Measure only parallel runs. Perpendicular intersections still use crossing jumps.
function crowding(a: Point, b: Point, occupied: Segment[]) {
  const horizontal = a.y === b.y
  const along = horizontal ? "x" : "y"
  const across = horizontal ? "y" : "x"
  const start = Math.min(a[along], b[along])
  const end = Math.max(a[along], b[along])
  let cost = 0
  for (const previous of occupied) {
    if (previous.a[across] !== previous.b[across]) continue
    const separation = Math.abs(previous.a[across] - a[across])
    if (separation >= laneSpacing) continue
    const overlap =
      Math.min(end, Math.max(previous.a[along], previous.b[along])) -
      Math.max(start, Math.min(previous.a[along], previous.b[along]))
    if (overlap > 0) cost += overlap * (1 - separation / laneSpacing)
  }
  return cost
}

// Search the orthogonal grid formed by obstacle edges and endpoint ports.
// A turn penalty favors a few long segments over a staircase of short ones.
function findRoute(
  source: DiagramBox,
  target: DiagramBox,
  boxes: DiagramBox[],
  sourceLane: number,
  targetLane: number,
  occupied: Segment[],
  gap: number
) {
  const obstacles = boxes.map((b) => ({
    x: b.x - gap,
    y: b.y - gap,
    width: b.width + 2 * gap,
    height: b.height + 2 * gap,
  }))
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]
  function outlets(box: DiagramBox, lane: number) {
    return ports(box, lane)
      .map((anchor, i) => ({
        anchor,
        x: anchor.x + directions[i][0] * gap,
        y: anchor.y + directions[i][1] * gap,
        axis: i < 2 ? 0 : 1,
      }))
      .filter(
        (p) =>
          !blocked(
            p.anchor,
            p,
            obstacles.filter((_, i) => boxes[i] !== box)
          )
      )
  }
  const starts = outlets(source, sourceLane),
    ends = outlets(target, targetLane)
  if (!starts.length || !ends.length) return
  if (source === target) {
    starts.splice(0, starts.length, starts[0])
  }
  const goals = ends.filter(
    (p) => source !== target || distance(p.anchor, starts[0].anchor) > 0
  )
  if (!goals.length) return
  const terminals = [...starts, ...goals]
  const sorted = (values: number[]) =>
    Array.from(new Set(values)).sort((a, b) => a - b)
  const xs = sorted([
    ...obstacles.flatMap((b) => [b.x, b.x + b.width]),
    ...terminals.map((p) => p.x),
    ...occupied
      .filter((s) => s.a.x === s.b.x)
      .flatMap((s) => [s.a.x - laneSpacing, s.a.x + laneSpacing]),
  ])
  const ys = sorted([
    ...obstacles.flatMap((b) => [b.y, b.y + b.height]),
    ...terminals.map((p) => p.y),
    ...occupied
      .filter((s) => s.a.y === s.b.y)
      .flatMap((s) => [s.a.y - laneSpacing, s.a.y + laneSpacing]),
  ])
  type Step = {
    ix: number
    iy: number
    axis: number
    cost: number
    score: number
    point: Point
    prev?: Step
    anchor: Point
  }
  const frontier: Step[] = []
  const best = new Map<number, number>()
  const key = (ix: number, iy: number, axis: number) =>
    (iy * xs.length + ix) * 2 + axis
  function queue(
    ix: number,
    iy: number,
    axis: number,
    cost: number,
    anchor: Point,
    prev?: Step
  ) {
    const id = key(ix, iy, axis)
    if (cost >= (best.get(id) ?? Infinity)) return
    best.set(id, cost)
    const point = { x: xs[ix], y: ys[iy] }
    const score =
      cost +
      Math.min(
        ...goals.map((g) => Math.abs(g.x - point.x) + Math.abs(g.y - point.y))
      )
    let low = 0,
      high = frontier.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (frontier[mid].score > score) low = mid + 1
      else high = mid
    }
    frontier.splice(low, 0, { ix, iy, axis, cost, score, point, prev, anchor })
  }
  for (const s of starts)
    queue(xs.indexOf(s.x), ys.indexOf(s.y), s.axis, 0, s.anchor)
  while (frontier.length) {
    const step = frontier.pop()!
    if (step.cost !== best.get(key(step.ix, step.iy, step.axis))) continue
    const goal = goals.find((g) => g.x === step.point.x && g.y === step.point.y)
    if (goal) {
      const result = [goal.anchor]
      for (let node: Step | undefined = step; node; node = node.prev)
        result.push(node.point)
      result.push(step.anchor)
      return simplify(result.reverse())
    }
    for (const [dx, dy] of directions) {
      const ix = step.ix + dx,
        iy = step.iy + dy
      if (ix < 0 || iy < 0 || ix >= xs.length || iy >= ys.length) continue
      const point = { x: xs[ix], y: ys[iy] },
        axis = dx ? 0 : 1
      if (!blocked(step.point, point, obstacles))
        queue(
          ix,
          iy,
          axis,
          step.cost +
            distance(step.point, point) +
            8 * crowding(step.point, point, occupied) +
            (axis === step.axis ? 0 : 24),
          step.anchor,
          step
        )
    }
  }
}

export function elbowRoute(
  source: DiagramBox,
  target: DiagramBox,
  boxes: DiagramBox[],
  sourceLane: number,
  targetLane: number,
  occupied: Segment[]
) {
  for (const gap of [clearance, 0]) {
    const route = findRoute(
      source,
      target,
      boxes,
      sourceLane,
      targetLane,
      [],
      gap
    )
    if (!route) continue
    if (!segments(route).some(({ a, b }) => crowding(a, b, occupied) > 0))
      return route
    return (
      findRoute(source, target, boxes, sourceLane, targetLane, occupied, gap) ??
      route
    )
  }
  // Completely overlapping cards can enclose every port.
  if (source === target) return loopRoute(source, sourceLane)
  const rightward = center(source).x <= center(target).x
  const a = ports(source, sourceLane)[rightward ? 1 : 0]
  const b = ports(target, targetLane)[rightward ? 0 : 1]
  return simplify([a, { x: b.x, y: a.y }, b])
}

export function segments(points: Point[]): Segment[] {
  return points.slice(1).map((b, i) => ({ a: points[i], b }))
}

function intersection({ a, b }: Segment, other: Segment) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    ex = other.b.x - other.a.x,
    ey = other.b.y - other.a.y
  const determinant = dx * ey - dy * ex
  if (!determinant) return
  const ox = other.a.x - a.x,
    oy = other.a.y - a.y
  const t = (ox * ey - oy * ex) / determinant,
    u = (ox * dy - oy * dx) / determinant
  if (t > 0 && t < 1 && u > 0 && u < 1) return t * distance(a, b)
}

export function drawRoute(points: Point[], underneath: Segment[]) {
  let path = "M " + coord(points[0])
  const bridges: string[] = []
  const parts = segments(points)
  let longest = 0,
    midpoint = points[0]
  for (const segment of parts) {
    const { a, b } = segment,
      length = distance(a, b)
    if (length > longest) {
      longest = length
      midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }
    const at = (d: number) => ({
      x: a.x + ((b.x - a.x) * d) / length,
      y: a.y + ((b.y - a.y) * d) / length,
    })
    const crossings = underneath
      .map((s) => intersection(segment, s))
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b)
    let end = 0
    for (const d of crossings) {
      const r = Math.min(6, d - end, length - d)
      if (r < 1) continue
      const start = coord(at(d - r)),
        finish = coord(at(d + r)),
        c = at(d)
      if (a.y === b.y) c.y -= 2 * r
      else c.x += 2 * r
      const arc = " Q " + coord(c) + " " + finish
      path += " L " + start + arc
      bridges.push("M " + start + arc)
      end = d + r
    }
    path += " L " + coord(b)
  }
  return { path, midpoint, bridges }
}
