/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, render } from '../dist/index.mjs'
import { meshGlb, packGlb } from '../scripts/glb.mjs'

const geometry = { positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], indices: [0, 1, 2, 0, 2, 3] }
const base = meshGlb([{ geometry, color: [0.5, 0.25, 1, 1], unlit: true }])
const options = { width: 32, height: 32, supersample: 1, background: 'transparent', camera: { type: 'orthographic', position: [0, 0, 2], target: [0, 0, 0], height: 2 } }
function edit(change) {
  const length = new DataView(base.buffer).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(base.subarray(20, 20 + length)))
  change(json)
  return packGlb(json, base.subarray(28 + length))
}

test('asset versions honor minor forward compatibility and minimum requirements', async () => {
  const expected = (await render(base, options)).rgba
  for (const asset of [{ version: '2.1' }, { version: '2.7', minVersion: '2.0' }]) {
    assert.deepEqual(
      (
        await render(
          edit(json => {
            json.asset = asset
          }),
          options,
        )
      ).rgba,
      expected,
    )
  }
  for (const asset of [{ version: '1.0' }, { version: '3.0' }, { version: '2.foo' }, { version: '2.0.1' }, { version: '+2.0' }, { version: '2.1', minVersion: '2.1' }]) {
    await assert.rejects(
      createRenderer(
        edit(json => {
          json.asset = asset
        }),
      ),
      /version|minVersion/,
    )
  }
})

test('GLB ignores unknown trailing chunks and rejects invalid chunk layout', async () => {
  const extended = new Uint8Array(base.length + 12)
  extended.set(base)
  const view = new DataView(extended.buffer)
  view.setUint32(8, extended.length, true)
  view.setUint32(base.length, 4, true)
  view.setUint32(base.length + 4, 0x12345678, true)
  assert.deepEqual((await render(extended, options)).rgba, (await render(base, options)).rgba)
  view.setUint32(base.length + 4, 0x4e4f534a, true)
  await assert.rejects(createRenderer(extended), /duplicate/)
  const invalid = base.slice()
  new DataView(invalid.buffer).setUint32(16, 0x004e4942, true)
  await assert.rejects(createRenderer(invalid), /first chunk/)
  new DataView(invalid.buffer).setUint32(12, 3, true)
  await assert.rejects(createRenderer(invalid), /multiple of 4/)
})

test('triangle strips and fans preserve winding and skip degenerate triangles', async () => {
  const expected = (await render(base, options)).rgba
  for (const [mode, indices] of [
    [5, [0, 1, 3, 2]],
    [5, [0, 0, 0, 1, 3, 2]],
    [6, [0, 1, 2, 3]],
  ]) {
    const glb = meshGlb([{ geometry: { ...geometry, indices }, color: [0.5, 0.25, 1, 1], unlit: true }])
    const length = new DataView(glb.buffer).getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)))
    json.meshes[0].primitives[0].mode = mode
    assert.deepEqual((await render(packGlb(json, glb.subarray(28 + length)), options)).rgba, expected)
  }
})

test('non-indexed triangles match indexed geometry', async () => {
  const positions = geometry.indices.flatMap(index => geometry.positions.slice(index * 3, index * 3 + 3))
  const glb = meshGlb([{ geometry: { positions, indices: [0, 1, 2, 3, 4, 5] }, color: [0.5, 0.25, 1, 1], unlit: true }])
  const length = new DataView(glb.buffer).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)))
  delete json.meshes[0].primitives[0].indices
  const actual = await render(packGlb(json, glb.subarray(28 + length)), options)
  assert.deepEqual(actual.rgba, (await render(base, options)).rgba)
})
