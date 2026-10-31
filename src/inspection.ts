/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import type { AssetInfo, Color, OutlineStyle, ProjectedPoint, RenderOptions, ResolvedFrame, Vec3 } from './options.js'

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const srgb = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)))
function over(rgba: Uint8Array, pixel: number, color: Color, coverage: number) {
  const a = color[3] * coverage
  if (a <= 0) return
  const i = pixel * 4,
    back = rgba[i + 3] / 255,
    alpha = a + back * (1 - a)
  for (let c = 0; c < 3; c++) rgba[i + c] = srgb((linear(color[c]) * a + linear(rgba[i + c] / 255) * back * (1 - a)) / alpha)
  rgba[i + 3] = Math.round(alpha * 255)
}
function lineDistance(x: number, y: number, a: ProjectedPoint, b: ProjectedPoint) {
  const dx = b.x! - a.x!,
    dy = b.y! - a.y!,
    length = dx * dx + dy * dy
  const t = length ? Math.min(1, Math.max(0, ((x - a.x!) * dx + (y - a.y!) * dy) / length)) : 0
  return { distance: Math.hypot(x - a.x! - dx * t, y - a.y! - dy * t), t }
}
function eachPixel(width: number, height: number, box: number[], paint: (x: number, y: number, i: number) => void) {
  const [left, top, right, bottom] = box
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(height, Math.ceil(bottom)); y++)
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(width, Math.ceil(right)); x++) paint(x, y, y * width + x)
}

export function outline(rgba: Uint8Array, depth: Float32Array, mask: Float32Array, width: number, height: number, style: OutlineStyle) {
  const radius = (style.width ?? 1.5) / 2,
    alpha = new Float32Array(width * height)
  const edge = (x0: number, y0: number, x1: number, y1: number, z: number) => {
    const a = { x: x0, y: y0 } as ProjectedPoint,
      b = { x: x1, y: y1 } as ProjectedPoint
    eachPixel(width, height, [x0 - radius - 1, y0 - radius - 1, x1 + radius + 1, y1 + radius + 1], (x, y, i) => {
      const coverage = Math.min(1, Math.max(0, radius + 0.5 - lineDistance(x + 0.5, y + 0.5, a, b).distance))
      const visible = z <= depth[i] + (style.depthBias ?? 0)
      alpha[i] = Math.max(alpha[i], coverage * (visible ? 1 : (style.occludedAlpha ?? 0)))
    })
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        z = mask[i]
      if (!Number.isFinite(z)) continue
      if (x === 0 || !Number.isFinite(mask[i - 1])) edge(x, y, x, y + 1, z)
      if (x === width - 1 || !Number.isFinite(mask[i + 1])) edge(x + 1, y, x + 1, y + 1, z)
      if (y === 0 || !Number.isFinite(mask[i - width])) edge(x, y, x + 1, y, z)
      if (y === height - 1 || !Number.isFinite(mask[i + width])) edge(x, y + 1, x + 1, y + 1, z)
    }
  for (let i = 0; i < alpha.length; i++) if (alpha[i]) over(rgba, i, style.color ?? [1, 1, 1, 1], alpha[i])
}

export function annotate(rgba: Uint8Array, depth: Float32Array, frame: ResolvedFrame, opts: RenderOptions, info: AssetInfo, project: (points: Vec3[]) => ProjectedPoint[]) {
  const parents = new Map(info.nodes.map(node => [node.index, node.parent]))
  const offset = (node: number | undefined): Vec3 => {
    const result: Vec3 = [0, 0, 0]
    while (node !== undefined) {
      for (const item of opts.nodeTranslations ?? []) if (item.node === node) for (let c = 0; c < 3; c++) result[c] += item.translation[c]
      node = parents.get(node) ?? undefined
    }
    return result
  }
  const { width, height } = frame
  const near = frame.camera.state.near,
    far = frame.camera.state.far ?? Infinity
  const prepared = (opts.annotations ?? []).map(a => {
    const translation = offset(a.selection === undefined ? a.node : info.selections.find(s => s.id === a.selection)?.node)
    const moved = (p: Vec3) => p.map((v, i) => v + translation[i]) as Vec3
    return { a, points: a.type === 'line' ? [moved(a.start), moved(a.end)] : [moved(a.position)] }
  })
  if (!prepared.length) return
  const all = project(prepared.flatMap(a => a.points))
  let cursor = 0
  for (const item of prepared) {
    const a = item.a
    let points = item.points
    let projected = all.slice(cursor, (cursor += points.length))
    if (a.type === 'line') {
      const [az, bz] = projected.map(p => p.depth),
        dz = bz - az
      let start = 0,
        end = 1
      if (dz === 0) {
        if (az < near || az > far) continue
      } else {
        const t0 = (near - az) / dz,
          t1 = (far - az) / dz
        start = Math.max(0, Math.min(t0, t1))
        end = Math.min(1, Math.max(t0, t1))
        if (start > end) continue
      }
      const mix = (t: number) => points[0].map((v, i) => v + (points[1][i] - v) * t) as Vec3
      if (start !== 0 || end !== 1) {
        points = [mix(start), mix(end)]
        projected = project(points)
      }
    }
    const p = projected[0]
    if (projected.some(p => p.x === null || p.y === null) || p.depth < near || p.depth > far) continue
    const color = a.color ?? [1, 0.5, 0, 1]
    const visible = (z: number, i: number) => a.depth === 'always' || z <= depth[i] + (a.depthBias ?? 0)
    if (a.type === 'label') {
      const left = p.x! + (a.offset?.[0] ?? 0),
        top = p.y! + (a.offset?.[1] ?? 0),
        image = a.image
      eachPixel(width, height, [left, top, left + image.width, top + image.height], (x, y, i) => {
        if (!visible(p.depth, i)) return
        const sx = Math.floor(x + 0.5 - left),
          sy = Math.floor(y + 0.5 - top)
        if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) return
        const n = (sy * image.width + sx) * 4
        over(
          rgba,
          i,
          [a.color?.[0] ?? image.rgba[n] / 255, a.color?.[1] ?? image.rgba[n + 1] / 255, a.color?.[2] ?? image.rgba[n + 2] / 255, (image.rgba[n + 3] / 255) * (a.color?.[3] ?? 1)],
          1,
        )
      })
      continue
    }
    const radius = a.type === 'line' ? (a.width ?? 1.5) / 2 : (a.radius ?? 4)
    const stroke = a.type === 'ring' ? (a.width ?? 1.5) / 2 : 0
    const q = a.type === 'line' ? projected[1] : p
    eachPixel(
      width,
      height,
      [
        Math.min(p.x!, q.x!) - radius - stroke - 1,
        Math.min(p.y!, q.y!) - radius - stroke - 1,
        Math.max(p.x!, q.x!) + radius + stroke + 1,
        Math.max(p.y!, q.y!) + radius + stroke + 1,
      ],
      (x, y, i) => {
        let distance: number,
          z = p.depth
        if (a.type === 'line') {
          const d = lineDistance(x + 0.5, y + 0.5, p, q)
          distance = d.distance - radius
          z = frame.camera.state.projection.type === 'perspective' ? 1 / ((1 - d.t) / p.depth + d.t / q.depth) : p.depth + (q.depth - p.depth) * d.t
        } else {
          const d = Math.hypot(x + 0.5 - p.x!, y + 0.5 - p.y!)
          distance = a.type === 'ring' ? Math.abs(d - radius) - stroke : d - radius
        }
        if (visible(z, i)) over(rgba, i, color, Math.min(1, Math.max(0, 0.5 - distance)))
      },
    )
  }
}

export function fill(rgba: Uint8Array, depth: Float32Array, mask: Float32Array, color: Color, style?: OutlineStyle) {
  for (let i = 0; i < mask.length; i++) if (Number.isFinite(mask[i])) over(rgba, i, color, mask[i] <= depth[i] + (style?.depthBias ?? 0) ? 1 : (style?.occludedAlpha ?? 0))
}
