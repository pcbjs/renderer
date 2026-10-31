/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { createRenderer } from '../dist/index.mjs'
import { gridGlb, cellsFor } from './bench-scene.mjs'

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
