/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer } from '../dist/index.mjs'
import { boxGeometry, meshGlb } from '../scripts/glb.mjs'
const geometry = boxGeometry([-0.6, 0, 0], [0.6, 0.8, 0.4])
const glb = meshGlb([{ name: 'object', geometry, color: [0.2, 0.5, 0.8, 1] }])
const options = {
  width: 65,
  height: 48,
  background: 'transparent',
  camera: { type: 'orthographic', position: [0, 0, 4], target: [0, 0, 0], height: 2 },
  outputs: { depth: true, nodeIds: true },
  includeFrame: true,
}
function flipped(a, width, height, channels = 1) {
  const result = new a.constructor(a.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) result.set(a.subarray((y * width + x) * channels, (y * width + x + 1) * channels), (y * width + width - 1 - x) * channels)
  return result
}

test('mirror reflects geometry, selection masks, depth and IDs while preserving camera handedness and frame replay', async () => {
  const r = await createRenderer(glb, { selectionGeometry: [{ id: 'part', positions: geometry.positions, indices: geometry.indices }] })
  try {
    for (const supersample of [1, 2]) {
      const opts = { ...options, supersample, styles: [{ selections: ['part'], tint: [1, 0, 0, 0.5], outline: { color: [0, 1, 0, 1], width: 2 } }] }
      const normal = await r.render(opts),
        mirrored = await r.render({ ...opts, mirror: true })
      for (const [name, channels] of [
        ['rgba', 4],
        ['depth', 1],
        ['nodeIds', 1],
      ])
        assert.deepEqual(mirrored[name], flipped(normal[name], opts.width, opts.height, channels))
      assert.deepEqual(mirrored.frame.camera, normal.frame.camera)
      assert.equal(mirrored.frame.mirror, true)
      assert.deepEqual((await r.render({ ...opts, ...mirrored.frame })).rgba, mirrored.rgba)
      const prepared = r.prepare({ width: opts.width, height: opts.height, camera: opts.camera, mirror: true })
      assert.deepEqual(prepared, mirrored.frame)
      const a = r.project(normal.frame, [[-0.6, 0, 0]])[0],
        b = r.project(mirrored.frame, [[-0.6, 0, 0]])[0]
      assert.equal(b.x, opts.width - a.x)
      assert.equal(b.y, a.y)
      assert.equal(b.depth, a.depth)
    }
    await assert.rejects(r.render({ ...options, mirror: 1 }), e => e.path === 'mirror')
  } finally {
    r.dispose()
  }
})

test('mirrored annotations move their anchors, preserve label orientation and use mirrored occlusion', async () => {
  const r = await createRenderer(glb)
  try {
    const opts = { ...options, width: 64, supersample: 1, mirror: true }
    const label = { id: 'label', type: 'label', position: [-0.5, 0, 1], image: { width: 3, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]) } }
    const normal = await r.render(opts)
    const image = await r.render({ ...opts, annotations: [label] })
    const [point] = r.project(image.frame, [label.position])
    const at = (Math.floor(point.y) * opts.width + Math.floor(point.x)) * 4
    assert.deepEqual(image.rgba.slice(at, at + 12), label.image.rgba)
    const hidden = { ...label, position: [-0.6, 0, -1] }
    assert.deepEqual((await r.render({ ...opts, annotations: [hidden] })).rgba, normal.rgba)
    const marker = { id: 'marker', type: 'marker', position: [-0.6, 0, 1], radius: 3, color: [1, 0, 0, 1] }
    const unmirrored = await r.render({ ...opts, mirror: false, annotations: [marker], edges: { color: [0, 1, 0, 1] } })
    const mirrored = await r.render({ ...opts, annotations: [marker], edges: { color: [0, 1, 0, 1] } })
    assert.deepEqual(mirrored.rgba, flipped(unmirrored.rgba, opts.width, opts.height, 4))
  } finally {
    r.dispose()
  }
})

test('mirrored fit padding reserves the requested final output edge', async () => {
  const r = await createRenderer(glb)
  try {
    const frame = r.prepare({ width: 128, height: 64, mirror: true, camera: { type: 'fit', projection: 'orthographic', direction: [0, 0, 1], padding: { left: 64 } } })
    const point = r.project(frame, [[-0.6, 0, 0]])[0]
    assert.ok(point.x > 64 && point.x < 128)
    const image = await r.render({ ...frame, background: 'transparent', supersample: 1 })
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) assert.equal(image.rgba[(y * 128 + x) * 4 + 3], 0)
  } finally {
    r.dispose()
  }
})
