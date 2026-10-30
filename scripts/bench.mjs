/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { createRenderer } from '../dist/index.mjs'
import { meshGlb } from './glb.mjs'

function grid(n) {
  const verts = n + 1
  const positions = []
  const normals = []
  const indices = []
  for (let y = 0; y < verts; y++) {
    for (let x = 0; x < verts; x++) {
      positions.push(-1 + (2 * x) / n, 0, -1 + (2 * y) / n)
      normals.push(0, 1, 0)
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * verts + x
      indices.push(i, i + verts, i + 1, i + 1, i + verts, i + verts + 1)
    }
  }
  return { positions, normals, indices }
}

function gridGlb(n) {
  return meshGlb([{ name: 'grid', geometry: grid(n), color: [0.7, 0.72, 0.74, 1], roughness: 1 }])
}

function cellsFor(triangles) {
  let n = 1
  while (2 * n * n < triangles) n++
  return n
}

const targets = [
  { triangles: 300_000, budget: 2 },
  { triangles: 1_000_000, budget: 10 },
]
const only = Number(process.argv.slice(2).find(arg => !arg.startsWith('--'))) || 0
const quality = process.argv.includes('--studio') ? { lighting: 'studio', shadows: true } : {}
for (const t of targets) {
  if (only && t.triangles !== only) continue
  const n = cellsFor(t.triangles)
  const glb = gridGlb(n)
  const t0 = performance.now()
  const scene = await createRenderer(glb)
  const loaded = performance.now()
  const frame = await scene.render({ width: 1600, height: 1000, supersample: 2, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] }, ...quality })
  const rendered = performance.now()
  const triangles = scene.triangles
  scene.dispose()
  if (frame.rgba.length !== 1600 * 1000 * 4) throw new Error('render returned the wrong number of bytes')
  const loadS = (loaded - t0) / 1000
  const renderS = (rendered - loaded) / 1000
  const totalS = (rendered - t0) / 1000
  const rate = triangles / renderS
  const met = renderS < t.budget ? 'met' : 'over'
  console.log(
    `${quality.lighting ?? 'classic'}  triangles ${triangles}  load ${loadS.toFixed(2)} s  render ${renderS.toFixed(2)} s  total ${totalS.toFixed(2)} s  ${Math.round(rate)} tri/s  target render < ${t.budget} s  ${met}`,
  )
}
