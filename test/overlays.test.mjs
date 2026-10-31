/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, render } from '../dist/index.mjs'
import { meshGlb } from '../scripts/glb.mjs'
const quad = (name, z, size, color) => ({
  name,
  unlit: true,
  doubleSided: true,
  color,
  roughness: 1,
  geometry: { positions: [-size, -size, z, size, -size, z, size, size, z, -size, size, z], indices: [0, 1, 2, 0, 2, 3] },
})
const opts = {
  width: 64,
  height: 64,
  supersample: 2,
  background: 'transparent',
  camera: { type: 'orthographic', position: [0, 0, 4], target: [0, 0, 0], height: 4, near: 0, far: 10 },
}
const pixel = (r, x = 32, y = 32) => [...r.rgba.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)]

test('auxiliary depth and node IDs describe geometry, including nearest nonzero blend', async () => {
  const glb = meshGlb([quad('back', 0, 1, [1, 0, 0, 1]), { ...quad('front', 1, 0.5, [0, 0, 1, 0.5]), alphaMode: 'BLEND' }])
  const base = await render(glb, opts)
  const r = await render(glb, { ...opts, outputs: { depth: true, nodeIds: true } })
  assert.deepEqual(r.rgba, base.rgba)
  assert.equal(r.depth[32 * 64 + 32], 3)
  assert.equal(r.nodeIds[32 * 64 + 32], 1)
  assert.equal(r.depth[0], Infinity)
  assert.equal(r.nodeIds[0], 0xffffffff)
})

test('annotations obey depth and ordering without affecting geometry outputs or fit', async () => {
  const glb = meshGlb([quad('shell', 1, 1, [0, 0, 1, 1])])
  const base = await render(glb, { ...opts, outputs: { depth: true }, includeFrame: true })
  const marker = { id: 'mark', type: 'marker', position: [0, 0, 0], radius: 5, color: [1, 0, 0, 1] }
  const hidden = await render(glb, { ...opts, annotations: [marker] })
  assert.deepEqual(hidden.rgba, base.rgba)
  const visible = await render(glb, { ...opts, outputs: { depth: true }, includeFrame: true, annotations: [{ ...marker, depth: 'always' }] })
  assert.deepEqual(pixel(visible), [255, 0, 0, 255])
  assert.deepEqual(visible.depth, base.depth)
  assert.deepEqual(visible.frame, base.frame)
  const label = { id: 'label', type: 'label', position: [0, 0, 2], image: { width: 1, height: 1, rgba: new Uint8Array([0, 255, 0, 255]) } }
  assert.deepEqual(pixel(await render(glb, { ...opts, annotations: [{ ...marker, depth: 'always' }, label] })), [0, 255, 0, 255])
})

test('styles fade occluders in linear space and apply deterministic group precedence', async () => {
  const glb = meshGlb([quad('back', 0, 1, [1, 0, 0, 1]), quad('front', 1, 1, [0, 0, 1, 1])])
  const faded = await render(glb, { ...opts, styles: [{ nodes: ['front'], opacity: 0.5 }] })
  assert.deepEqual(pixel(faded), [188, 0, 188, 255])
  const override = await render(glb, { ...opts, styles: [{ saturation: 0 }, { nodes: ['front'], tint: [0, 1, 0, 1] }] })
  assert.deepEqual(pixel(override), [0, 255, 0, 255])
  const mask = { ...quad('mask', 1, 1, [0, 0, 1, 0.1]), alphaMode: 'MASK', alphaCutoff: 0.5 }
  const image = await render(meshGlb([quad('back', 0, 1, [1, 0, 0, 1]), mask]), { ...opts, styles: [{ nodes: ['mask'], opacity: 0.2 }] })
  assert.deepEqual(pixel(image), [255, 0, 0, 255])
})

test('occluded outlines and fixed-size annotations survive supersampling and node movement', async () => {
  const r = await createRenderer(meshGlb([quad('small', 0, 0.4, [1, 0, 0, 1]), quad('shell', 1, 1, [0, 0, 1, 1])]))
  try {
    const style = { nodes: ['small'], outline: { color: [0, 1, 0, 1], width: 1.5, occludedAlpha: 0.5 } }
    const image = await r.render({ ...opts, styles: [style] })
    assert.ok(image.rgba.some((v, i) => i % 4 === 1 && v > 0))
    const marker = { id: 'anchor', node: 0, type: 'ring', position: [0, 0, 0], radius: 5, color: [0, 1, 0, 1], depth: 'always' }
    const a = await r.render({ ...opts, supersample: 1, annotations: [marker] })
    const b = await r.render({ ...opts, supersample: 3, annotations: [marker] })
    assert.deepEqual(a.rgba, b.rgba)
    const moved = await r.render({ ...opts, annotations: [marker], nodeTranslations: [{ node: 0, translation: [0.5, 0, 0] }] })
    assert.notDeepEqual(a.rgba, moved.rgba)
    await assert.rejects(r.render({ ...opts, annotations: [marker, marker] }), /unique/)
    await assert.rejects(r.render({ ...opts, styles: [{ opacity: 2 }] }), /zero and one/)
  } finally {
    r.dispose()
  }
})

test('lines clip to camera depth and labels preserve caller pixels with explicit occlusion', async () => {
  const glb = meshGlb([quad('shell', 1, 1, [0, 0, 1, 1])])
  const line = { id: 'line', type: 'line', start: [-1, 0, 5], end: [1, 0, 0], color: [1, 0, 0, 1], width: 2, depth: 'always' }
  const image = await render(glb, { ...opts, annotations: [line] })
  assert.ok(image.rgba.some((v, i) => i % 4 === 0 && v > 200))
  const outside = await render(glb, { ...opts, annotations: [{ ...line, start: [-1, 0, 5], end: [1, 0, 5] }] })
  assert.deepEqual(outside.rgba, (await render(glb, opts)).rgba)
  const label = { id: 'text', type: 'label', position: [0, 0, 0], image: { width: 3, height: 3, rgba: new Uint8Array(36).fill(255) } }
  const hidden = await render(glb, { ...opts, annotations: [label] })
  assert.deepEqual(hidden.rgba, outside.rgba)
  assert.deepEqual(pixel(await render(glb, { ...opts, annotations: [{ ...label, depth: 'always', color: [0, 1, 0, 1] }] })), [0, 255, 0, 255])
})
