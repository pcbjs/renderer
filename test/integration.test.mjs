/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createRenderer, encodePng } from '../dist/index.mjs'
import { meshGlb, packGlb } from '../scripts/glb.mjs'

for (const name of ['blinky', 'psu'])
  test(`pcbjs ${name} export supports repeatable top, bottom, hidden and styled views`, async () => {
    const r = await createRenderer(await readFile(new URL(`../docs/public/models/${name}.glb`, import.meta.url)))
    try {
      const opts = { width: 160, height: 120, supersample: 1 }
      const top = await r.render({ ...opts, camera: { type: 'fit', direction: [0, 1, 0], up: [0, 0, -1] } })
      const bottom = await r.render({ ...opts, camera: { type: 'fit', direction: [0, -1, 0], up: [0, 0, 1] } })
      assert.notDeepEqual(top.rgba, bottom.rgba)
      const node = r.info.nodes.find(n => r.bounds({ nodes: [n.index] })).index
      const frame = r.prepare({ width: opts.width, height: opts.height, camera: { type: 'fit', nodes: [node] } })
      const a = await r.render({ ...opts, ...frame, styles: [{ nodes: [node], saturation: 0, outline: { color: [1, 0.7, 0, 1] } }] })
      const b = await r.render({ ...opts, ...frame, styles: [{ nodes: [node], saturation: 0, outline: { color: [1, 0.7, 0, 1] } }] })
      assert.deepEqual(a.rgba, b.rgba)
      const hidden = await r.render({ ...opts, visibility: { only: [] }, background: 'transparent' })
      assert.ok(hidden.rgba.every(v => v === 0))
      assert.ok((await encodePng(a.rgba, a.width, a.height)).byteLength > 100)
    } finally {
      r.dispose()
    }
  })

test('selection and annotation anchors follow nested assembly translations while missing geometry stays empty', async () => {
  const geometry = { positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], indices: [0, 1, 2, 0, 2, 3] }
  const input = meshGlb([{ name: 'surface', geometry, unlit: true, doubleSided: true, color: [0, 0, 1, 1] }])
  const length = new DataView(input.buffer).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(input.subarray(20, 20 + length)))
  json.nodes.push({ name: 'assembly', children: [0] }, { name: 'missing-model' })
  json.scenes[0].nodes = [1, 2]
  const r = await createRenderer(packGlb(json, input.subarray(28 + length)), { selectionGeometry: [{ id: 'item', node: 0, ...geometry }] })
  try {
    assert.equal(r.bounds({ nodes: ['missing-model'] }), null)
    const nodeTranslations = [
      { node: 0, translation: [0.5, 0, 0] },
      { node: 1, translation: [0.5, 0, 0] },
    ]
    assert.deepEqual(r.bounds({ selections: ['item'], nodeTranslations }), { min: [0, -1, 0], max: [2, 1, 0] })
    const opts = { width: 64, height: 64, supersample: 1, nodeTranslations, camera: { type: 'orthographic', position: [0, 0, 4], target: [0, 0, 0], height: 4, near: 0, far: 10 } }
    const image = await r.render({
      ...opts,
      annotations: [{ id: 'finding', selection: 'item', type: 'marker', position: [0, 0, 0], color: [1, 0, 0, 1], radius: 3, depth: 'always' }],
    })
    assert.deepEqual([...image.rgba.slice((32 * 64 + 48) * 4, (32 * 64 + 48) * 4 + 4)], [255, 0, 0, 255])
  } finally {
    r.dispose()
  }
})
