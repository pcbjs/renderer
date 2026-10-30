/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { boxGeometry, meshGlb } from '../scripts/glb.mjs'
import { escTexture, maskTexture } from './texture.mjs'

const MM = 0.001
const mm = v => v * MM

function box(centerMm, sizeMm) {
  return boxGeometry(centerMm.map(mm), sizeMm.map(mm))
}

function cylinder(centerMm, radiusMm, heightMm, seg = 20) {
  const [cx, cy, cz] = centerMm.map(mm)
  const radiusM = radiusMm * MM
  const heightM = heightMm * MM
  const y0 = cy - heightM / 2
  const y1 = cy + heightM / 2
  const positions = []
  const normals = []
  const indices = []
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2
    const a1 = ((i + 1) / seg) * Math.PI * 2
    const x0 = Math.cos(a0)
    const z0 = Math.sin(a0)
    const x1 = Math.cos(a1)
    const z1 = Math.sin(a1)
    const base = positions.length / 3
    positions.push(
      cx + x0 * radiusM,
      y0,
      cz + z0 * radiusM,
      cx + x0 * radiusM,
      y1,
      cz + z0 * radiusM,
      cx + x1 * radiusM,
      y1,
      cz + z1 * radiusM,
      cx + x1 * radiusM,
      y0,
      cz + z1 * radiusM,
    )
    normals.push(x0, 0, z0, x0, 0, z0, x1, 0, z1, x1, 0, z1)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const top = positions.length / 3
  positions.push(cx, y1, cz)
  normals.push(0, 1, 0)
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    positions.push(cx + Math.cos(a) * radiusM, y1, cz + Math.sin(a) * radiusM)
    normals.push(0, 1, 0)
  }
  for (let i = 0; i < seg; i++) indices.push(top, top + 1 + i, top + 1 + ((i + 1) % seg))
  const bot = positions.length / 3
  positions.push(cx, y0, cz)
  normals.push(0, -1, 0)
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    positions.push(cx + Math.cos(a) * radiusM, y0, cz + Math.sin(a) * radiusM)
    normals.push(0, -1, 0)
  }
  for (let i = 0; i < seg; i++) indices.push(bot, bot + 1 + ((i + 1) % seg), bot + 1 + i)
  return { positions, normals, indices }
}

function merge(parts) {
  const positions = []
  const normals = []
  const indices = []
  for (const part of parts) {
    const base = positions.length / 3
    positions.push(...part.positions)
    normals.push(...part.normals)
    for (const i of part.indices) indices.push(base + i)
  }
  return { positions, normals, indices }
}

export function framed(nodes) {
  let min = [Infinity, Infinity, Infinity]
  let max = [-Infinity, -Infinity, -Infinity]
  for (const node of nodes) {
    const p = node.geometry.positions
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[i + k])
        max[k] = Math.max(max[k], p[i + k])
      }
    }
  }
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  return {
    glb: meshGlb(nodes),
    target: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    span: Math.max(span[0], span[1], span[2]),
  }
}

function trace(x1, z1, x2, z2, w = 0.32) {
  const dx = x2 - x1
  const dz = z2 - z1
  const y = 1.9
  if (Math.abs(dx) >= Math.abs(dz)) return box([(x1 + x2) / 2, y, z1], [Math.abs(dx) + w, 0.05, w])
  return box([x1, y, (z1 + z2) / 2], [w, 0.05, Math.abs(dz) + w])
}

function qfn(x, z, span, pinsPerSide, pitch) {
  const body = []
  const pins = []
  const h = 0.85
  const y = 1.86 + h / 2
  body.push(box([x, y, z], [span, h, span]))
  body.push(box([x, y + h / 2 + 0.06, z], [span * 0.78, 0.12, span * 0.78]))
  body.push(box([x - span * 0.32, y + h / 2 + 0.14, z - span * 0.32], [0.55, 0.08, 0.55]))
  const edge = span / 2
  for (let i = 0; i < pinsPerSide; i++) {
    const along = (i - (pinsPerSide - 1) / 2) * pitch
    const foot = 0.85
    const rise = 0.42
    pins.push(box([x + edge + foot / 2 - 0.05, 1.96, z + along], [foot, 0.16, 0.22]))
    pins.push(box([x - edge - foot / 2 + 0.05, 1.96, z + along], [foot, 0.16, 0.22]))
    pins.push(box([x + along, 1.96, z + edge + foot / 2 - 0.05], [0.22, 0.16, foot]))
    pins.push(box([x + along, 1.96, z - edge - foot / 2 + 0.05], [0.22, 0.16, foot]))
    pins.push(box([x + edge - 0.05, 1.96 + rise / 2, z + along], [0.2, rise, 0.22]))
    pins.push(box([x - edge + 0.05, 1.96 + rise / 2, z + along], [0.2, rise, 0.22]))
    pins.push(box([x + along, 1.96 + rise / 2, z + edge - 0.05], [0.22, rise, 0.2]))
    pins.push(box([x + along, 1.96 + rise / 2, z - edge + 0.05], [0.22, rise, 0.2]))
  }
  return { body: merge(body), pins: merge(pins) }
}

function passive(x, z, w, d, h, y0 = 1.86) {
  return box([x, y0 + h / 2, z], [w, h, d])
}

function usbPorts(x0, yBase, zFront) {
  const shell = []
  const tongue = []
  const gold = []
  const housing = []
  const pitch = 17.2
  const W = 13.1
  const H = 6.35
  const D = 14.2
  const t = 0.42
  for (const side of [-1, 1]) {
    const x = x0 + side * (pitch / 2)
    const y = yBase + H / 2
    const z = zFront - D / 2
    shell.push(box([x, yBase + t / 2, z], [W, t, D]))
    shell.push(box([x, yBase + H - t / 2, z], [W, t, D]))
    shell.push(box([x - W / 2 + t / 2, y, z], [t, H, D]))
    shell.push(box([x + W / 2 - t / 2, y, z], [t, H, D]))
    shell.push(box([x, y, zFront - D + t / 2], [W - t * 2, H - t * 2, t]))
    const tz = zFront - 5.6
    tongue.push(box([x, yBase + 2.05, tz], [8.6, 1.15, 8.2]))
    for (let i = 0; i < 4; i++) gold.push(box([x - 2.25 + i * 1.5, yBase + 2.7, tz + 1.1], [0.62, 0.1, 4.6]))
    for (let i = 0; i < 5; i++) gold.push(box([x - 2.2 + i * 1.1, yBase + 3.15, tz - 2.6], [0.38, 0.08, 2.8]))
    shell.push(box([x - W / 2 + 0.3, yBase - 0.35, zFront - D + 1.2], [0.7, 0.9, 1.4]))
    shell.push(box([x + W / 2 - 0.3, yBase - 0.35, zFront - D + 1.2], [0.7, 0.9, 1.4]))
  }
  housing.push(box([x0, yBase + 1.15, zFront - D - 3.2], [pitch + W + 1.5, 2.3, 7.2]))
  housing.push(cylinder([x0 - 12, yBase - 0.7, zFront - D - 2], 0.7, 1.6, 12))
  housing.push(cylinder([x0 + 12, yBase - 0.7, zFront - D - 2], 0.7, 1.6, 12))
  return { shell: merge(shell), tongue: merge(tongue), gold: merge(gold), housing: merge(housing) }
}

// Pi 5 outline follows the published mechanical drawing, 85 by 56 mm.
export function pi5Scene() {
  const fr4 = [0.62, 0.52, 0.32, 1]
  const plastic = [0.05, 0.05, 0.06, 1]
  const metal = [0.78, 0.8, 0.83, 1]
  const gold = [0.86, 0.68, 0.28, 1]
  const black = [0.08, 0.08, 0.09, 1]
  const nodes = []
  const add = (name, geometry, color, roughness, metallic, explodeMm) => {
    nodes.push({ name, geometry, color, roughness, metallic, ...(explodeMm ? { explode: explodeMm.map(mm) } : {}) })
  }
  add('board', box([0, 0.8, 0], [85, 1.6, 56]), fr4, 0.9, 0, null)
  const mask = box([0, 1.7, 0], [83, 0.18, 54])
  add('mask', { ...mask, uvs: planarBoard(mask.positions, 85, 56) }, [1, 1, 1, 1], 0.55, 0, null)
  nodes[nodes.length - 1].texture = maskTexture()
  const holes = []
  const rings = []
  for (const [x, z] of [
    [39, 24],
    [39, -24],
    [-39, 24],
    [-39, -24],
  ]) {
    rings.push(box([x, 1.86, z], [4.6, 0.08, 4.6]))
    holes.push(cylinder([x, 0.8, z], 1.6, 1.95, 14))
  }
  add('rings', merge(rings), gold, 0.35, 0.75, null)
  add('holes', merge(holes), black, 1, 0, null)
  const pins = []
  for (let i = 0; i < 20; i++) {
    const x = -24 + i * 2.54
    pins.push(box([x, 4.2, -24.2], [0.6, 5.2, 0.6]))
    pins.push(box([x, 4.2, -21.7], [0.6, 5.2, 0.6]))
    pins.push(box([x, 1.95, -24.2], [1.6, 0.16, 1.6]))
    pins.push(box([x, 1.95, -21.7], [1.6, 0.16, 1.6]))
  }
  add('gpio', merge(pins), gold, 0.3, 0.88, null)
  add('part:U1', box([-4, 2.7, 2], [16, 1.6, 16]), metal, 0.28, 0.82, [0, 3, 0])
  add('ram', box([14, 2.15, 2], [12, 0.9, 10]), black, 0.45, 0.15, null)
  add('wifi', box([6, 2.55, -12], [14, 1.3, 10]), metal, 0.32, 0.7, null)
  add('pmic', box([-16, 2.2, -8], [6, 0.8, 6]), black, 0.4, 0.2, null)
  const usb = usbPorts(28, 2.05, 22)
  add('usb3', usb.shell, metal, 0.22, 0.9, null)
  add('usb3-tongue', usb.tongue, [0.12, 0.32, 0.72, 1], 0.4, 0.05, null)
  add('usb3-pins', usb.gold, gold, 0.3, 0.85, null)
  add('ethernet', merge([box([36, 5.2, -8], [16, 7.2, 15]), box([40.5, 5.2, -8], [6, 5.4, 13])]), metal, 0.25, 0.8, null)
  add('hdmi', merge([box([-40, 3.2, 8], [8, 2.6, 8]), box([-40, 3.2, -2], [8, 2.6, 8])]), metal, 0.28, 0.75, null)
  add('usbc', box([-40, 2.8, -14], [8, 2.4, 8]), metal, 0.24, 0.85, null)
  add('csi', merge([box([-8, 2.15, 18], [14, 0.7, 3]), box([12, 2.15, 18], [14, 0.7, 3])]), black, 0.5, 0.1, null)
  add('pcie', box([22, 2.2, 16], [10, 0.8, 4]), black, 0.5, 0.1, null)
  return framed(nodes)
}

export function moduleScene() {
  return pi5Scene()
}

// Proportions follow OpenESC-30x30, an open 4-in-1 BLDC ESC, 41.6 by 42.5 mm.
export function escScene() {
  const black = [1, 1, 1, 1]
  const metal = [0.8, 0.82, 0.84, 1]
  const gold = [0.86, 0.68, 0.28, 1]
  const body = [0.1, 0.1, 0.11, 1]
  const nodes = []
  const add = (name, geometry, color, roughness, metallic) => {
    nodes.push({ name, geometry, color, roughness, metallic })
  }
  const board = box([0, 0.8, 0], [42, 1.6, 42.5])
  add('board', { ...board, uvs: planarBoard(board.positions, 42, 42.5) }, black, 0.5, 0.05)
  nodes[nodes.length - 1].texture = escTexture()
  const fets = []
  const mcus = []
  const pads = []
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const x = sx * 12
    const z = sz * 11
    for (let i = 0; i < 3; i++) fets.push(box([x - 2.2 + i * 2.2, 2.05, z], [1.8, 0.7, 2.6]))
    mcus.push(box([x, 2.15, z + sz * 4.2], [4, 0.7, 4]))
    pads.push(box([sx * 18, 1.95, sz * 16], [4.5, 0.2, 3.2]))
  }
  add('fets', merge(fets), metal, 0.28, 0.86)
  add('mcus', merge(mcus), body, 0.4, 0.12)
  add('pads', merge(pads), gold, 0.32, 0.84)
  const holes = []
  for (const [x, z] of [
    [15.25, 15.25],
    [15.25, -15.25],
    [-15.25, 15.25],
    [-15.25, -15.25],
  ])
    holes.push(cylinder([x, 0.8, z], 2, 1.9, 12))
  add('holes', merge(holes), [0.02, 0.02, 0.02, 1], 1, 0)
  const header = []
  for (let i = 0; i < 8; i++) header.push(box([-6 + i * 1.6, 2.6, 0], [0.45, 1.8, 0.45]))
  add('dshot', merge(header), gold, 0.3, 0.88)
  return framed(nodes)
}

function planarBoard(positions, width, depth) {
  const uvs = []
  for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i] / width + 0.5, positions[i + 2] / depth + 0.5)
  return uvs
}
