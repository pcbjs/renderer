/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, render } from '../dist/index.mjs'
import { meshGlb } from '../scripts/glb.mjs'

function rectangle(name, left, right) {
  return {
    name,
    unlit: true,
    doubleSided: true,
    color: [1, 1, 1, 1],
    roughness: 1,
    geometry: { positions: [left, -1, 0, right, -1, 0, right, 1, 0, left, 1, 0], indices: [0, 1, 2, 0, 2, 3] },
  }
}
const opts = { width: 128, height: 64, supersample: 2, background: 'transparent', camera: { type: 'orthographic', position: [0, 0, 4], target: [0, 0, 0], height: 2 } }

test('merged selection comparison preserves overlapping source shapes without repartitioning the visible surface', async () => {
  const merged = rectangle('merged', -2, 2)
  const a = rectangle('a', -2, 1)
  const b = rectangle('b', -1, 2)
  const expected = await render(meshGlb([a]), opts)
  // The two union triangles cross the original item boundary, so no whole-triangle subset describes item a.
  for (const subset of [[], [0, 1, 2], [0, 2, 3], merged.geometry.indices]) {
    const image = await render(meshGlb([{ ...merged, geometry: { ...merged.geometry, indices: subset } }]), opts)
    assert.notDeepEqual(image.rgba, expected.rgba)
  }
  const r = await createRenderer(meshGlb([merged, a, b]))
  try {
    const baseline = await render(meshGlb([merged]), opts)
    assert.deepEqual((await r.render({ ...opts, visibility: { only: ['merged'] } })).rgba, baseline.rgba)
    assert.deepEqual((await r.render({ ...opts, visibility: { only: ['a'] } })).rgba, expected.rgba)
    assert.deepEqual(r.bounds({ nodes: ['a'] }), { min: [-2, -1, 0], max: [1, 1, 0] })
    assert.deepEqual(r.bounds({ nodes: ['b'] }), { min: [-1, -1, 0], max: [2, 1, 0] })
    assert.equal(r.triangles, 6)
    const geometryBytes = node => node.geometry.positions.length * 4 + node.geometry.indices.length * 2
    assert.equal(geometryBytes(merged), 60)
    assert.equal(geometryBytes(a) + geometryBytes(b), 120)
  } finally {
    r.dispose()
  }
})

test('sidecar selection geometry supplies independent masks and translated bounds without changing the scene', async () => {
  const glb = meshGlb([rectangle('merged', -2, 2)])
  const geometry = ['a', 'b'].map((id, i) => ({ id, node: 0, ...rectangle(id, i ? -1 : -2, i ? 2 : 1).geometry }))
  const r = await createRenderer(glb, { selectionGeometry: geometry })
  try {
    const base = await render(glb, opts)
    assert.equal(r.triangles, 2)
    assert.deepEqual(
      r.info.selections.map(s => s.id),
      ['a', 'b'],
    )
    assert.deepEqual((await r.render(opts)).rgba, base.rgba)
    assert.deepEqual(r.bounds({ selections: ['a'] }), { min: [-2, -1, 0], max: [1, 1, 0] })
    assert.deepEqual(r.bounds({ selections: ['b'], nodeTranslations: [{ node: 0, translation: [0, 0, 1] }] }), { min: [-1, -1, 1], max: [2, 1, 1] })
    assert.equal(r.bounds({ selections: ['a'], visibility: { hidden: [0] } }), null)
    assert.equal(r.bounds({ selections: [] }), null)
    const styled = await r.render({
      ...opts,
      styles: [
        { selections: ['a'], tint: [1, 0, 0, 1] },
        { selections: ['b'], tint: [0, 1, 0, 1] },
      ],
    })
    const pixel = x => [...styled.rgba.slice((32 * 128 + x) * 4, (32 * 128 + x) * 4 + 4)]
    assert.deepEqual(pixel(8), [255, 0, 0, 255])
    assert.deepEqual(pixel(64), [0, 255, 0, 255])
    assert.deepEqual(pixel(120), [0, 255, 0, 255])
    const focused = r.prepare({ width: 64, height: 64, camera: { type: 'fit', selections: ['a'], direction: [0, 0, 1] } })
    assert.equal(focused.camera.type, 'resolved')
    await assert.rejects(r.render({ ...opts, styles: [{ selections: ['missing'] }] }), /unknown selection/)
    assert.throws(() => r.bounds({ selections: ['missing'] }), /unknown selection/)
    await assert.rejects(r.render({ ...opts, camera: { type: 'fit', selections: ['a'], nodes: [0] } }), /mutually exclusive/)
  } finally {
    r.dispose()
  }
  await assert.rejects(createRenderer(glb, { selectionGeometry: [geometry[0], geometry[0]] }), /unique/)
  await assert.rejects(createRenderer(glb, { selectionGeometry: [{ ...geometry[0], node: 123 }] }), /selected scene/)
  await assert.rejects(createRenderer(glb, { selectionGeometry: [{ ...geometry[0], indices: [0, 1, 99] }] }), /indices/)
})

test('selection masks respect host visibility, zero opacity and nearest transparent occlusion', async () => {
  const host = rectangle('host', -1, 1)
  const shell = rectangle('shell', -2, 2)
  shell.geometry.positions = shell.geometry.positions.map((v, i) => (i % 3 === 2 ? 1 : v))
  shell.color = [0, 0, 1, 0.5]
  shell.alphaMode = 'BLEND'
  const r = await createRenderer(meshGlb([host, shell]), { selectionGeometry: [{ id: 'item', node: 0, ...host.geometry }] })
  const selected = { selections: ['item'], tint: [1, 0, 0, 1] }
  const pixel = image => [...image.rgba.slice((32 * 128 + 64) * 4, (32 * 128 + 64) * 4 + 4)]
  try {
    const base = await r.render(opts)
    assert.deepEqual((await r.render({ ...opts, styles: [selected] })).rgba, base.rgba)
    const through = await r.render({ ...opts, styles: [{ ...selected, outline: { color: [1, 0, 0, 1], occludedAlpha: 1 } }] })
    assert.deepEqual(pixel(through), [255, 0, 0, 255])
    const noShell = { ...opts, visibility: { hidden: ['shell'] } }
    const faded = await r.render({ ...noShell, styles: [{ nodes: ['host'], opacity: 0 }, selected] })
    assert.deepEqual(pixel(faded), [255, 0, 0, 255])
    const hidden = { ...opts, visibility: { hidden: ['host'] } }
    assert.deepEqual((await r.render({ ...hidden, styles: [selected] })).rgba, (await r.render(hidden)).rgba)
  } finally {
    r.dispose()
  }
})

test('typed selection subarrays bypass JSON and are copied into WASM without retaining caller storage', async () => {
  const geometry = rectangle('selected', -2, 0).geometry
  const positions = new Float32Array(geometry.positions.length + 6).subarray(3, -3)
  const indices = new Uint32Array(geometry.indices.length + 2).subarray(1, -1)
  positions.set(geometry.positions)
  indices.set(geometry.indices)
  positions.toJSON = indices.toJSON = () => {
    throw new Error('geometry must not be serialized')
  }
  const glb = meshGlb([rectangle('merged', -2, 2)])
  const typed = await createRenderer(glb, { selectionGeometry: [{ id: 'item', node: 0, positions, indices }] })
  const plain = await createRenderer(glb, { selectionGeometry: [{ id: 'item', node: 0, ...geometry }] })
  try {
    positions.fill(100)
    indices.fill(0)
    assert.deepEqual(typed.bounds({ selections: ['item'] }), plain.bounds({ selections: ['item'] }))
    const options = { ...opts, styles: [{ selections: ['item'], tint: [1, 0, 0, 1], outline: { color: [0, 1, 0, 1] } }] }
    assert.deepEqual(await typed.render(options), await plain.render(options))
  } finally {
    typed.dispose()
    plain.dispose()
  }
  for (const invalid of [
    { positions: new Float32Array([NaN, 0, 0]) },
    { positions: new Float64Array(geometry.positions) },
    { positions: new Array(12) },
    { indices: new Uint32Array([0, 1, 100]) },
    { indices: new Int32Array([0, 1, 2]) },
    { indices: new Array(3) },
    { positions: new Float32Array(16777218) },
  ])
    await assert.rejects(createRenderer(glb, { selectionGeometry: [{ id: 'bad', ...geometry, ...invalid }] }), e => e.code === 'INVALID_OPTION')
})
