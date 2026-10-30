/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, render, encodePng } from '../dist/index.mjs'
import { meshGlb, packGlb } from '../scripts/glb.mjs'
import { decodePng } from './png.mjs'

const geometry = { positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], normals: Array(4).fill([0, 0, 1]).flat(), indices: [0, 1, 2, 0, 2, 3] }
const options = { width: 8, height: 8, supersample: 1, background: 'transparent', camera: { type: 'orthographic', position: [0, 0, 2], target: [0, 0, 0], height: 2 } }
const surface = { geometry, color: [1, 1, 1, 1], unlit: true }
const pixel = image => [...image.rgba.slice(4 * 27, 4 * 28)]
const at = z => ({ ...geometry, positions: geometry.positions.map((v, i) => (i % 3 === 2 ? z : v)) })
const edit = (glb, fn) => {
  const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)))
  fn(json)
  return packGlb(json, glb.subarray(28 + length))
}

test('BLEND composites in linear depth order and survives PNG round-trip', async () => {
  const nodes = [
    { ...surface, color: [0, 0, 1, 0.5], alphaMode: 'BLEND' },
    { ...surface, geometry: at(0.5), color: [1, 0, 0, 0.5], alphaMode: 'BLEND' },
  ]
  const image = await render(meshGlb(nodes), options)
  assert.deepEqual(pixel(image), [213, 0, 156, 191])
  assert.deepEqual((await render(meshGlb(nodes.toReversed()), options)).rgba, image.rgba)
  assert.equal(Buffer.compare(decodePng(await encodePng(image.rgba, 8, 8)).rgba, image.rgba), 0)
  const renderer = await createRenderer(meshGlb(nodes))
  try {
    await assert.rejects(renderer.render({ ...options, transparency: { maxLayers: 1 } }), /transparency.maxLayers/)
    assert.deepEqual((await renderer.render({ ...options, transparency: { maxLayers: 2 } })).rgba, image.rgba)
  } finally {
    renderer.dispose()
  }
})

test('texture, vertex and factor alpha multiply only for BLEND and MASK', async () => {
  const node = {
    ...surface,
    geometry: { ...geometry, colors: Array(4).fill([1, 1, 1, 0.5]).flat() },
    color: [1, 1, 1, 0.5],
    texture: { w: 1, h: 1, rgba: new Uint8Array([128, 64, 32, 128]) },
  }
  assert.deepEqual(pixel(await render(meshGlb([{ ...node, alphaMode: 'BLEND' }]), options)), [128, 64, 32, 32])
  assert.deepEqual(pixel(await render(meshGlb([{ ...node, alphaMode: 'OPAQUE' }]), options)), [128, 64, 32, 255])
  assert.deepEqual(pixel(await render(meshGlb([{ ...node, alphaMode: 'MASK', alphaCutoff: 0.2 }]), options)), [0, 0, 0, 0])
})

test('required unlit ignores lighting and emission but preserves culling and alpha', async () => {
  const glb = edit(meshGlb([{ ...surface, color: [0.5, 0.25, 0.125, 1], emissive: [1, 1, 1], metallic: 1 }]), json => {
    json.extensionsRequired = ['KHR_materials_unlit']
  })
  for (const lighting of ['classic', 'studio']) {
    assert.deepEqual(pixel(await render(glb, { ...options, lighting, shadows: true, light: { direction: [0, 0, -1], ambient: 0 } })), [188, 137, 99, 255])
  }
  const back = { ...surface, geometry: { ...geometry, indices: [2, 1, 0, 3, 2, 0] } }
  assert.equal(pixel(await render(meshGlb([back]), options))[3], 0)
  assert.equal(pixel(await render(meshGlb([{ ...back, doubleSided: true }]), options))[3], 255)
})

test('emissive strength retains HDR energy until exposure and tone mapping', async () => {
  const glb = edit(meshGlb([{ geometry, color: [0, 0, 0, 0.5], emissive: [0.25, 0, 0], emissiveStrength: 8, alphaMode: 'BLEND' }]), json => {
    json.extensionsRequired = ['KHR_materials_emissive_strength']
  })
  const opts = { ...options, light: { ambient: 0, direction: [0, 0, -1] } }
  assert.deepEqual(pixel(await render(glb, opts)), [255, 0, 0, 128])
  assert.deepEqual(pixel(await render(glb, { ...opts, exposure: -2 })), [188, 0, 0, 128])
  assert.deepEqual(pixel(await render(glb, { ...opts, toneMapping: 'reinhard' })), [213, 0, 0, 128])
  assert.deepEqual(pixel(await render(glb, { ...opts, background: [0, 0, 0, 1], toneMapping: 'reinhard' })), [188, 0, 0, 255])
  assert.deepEqual(pixel(await render(glb, { ...opts, exposure: -1, toneMapping: 'aces' })), [232, 0, 0, 128])
})

test('output transforms affect background and unlit colour without changing alpha', async () => {
  const empty = packGlb({ asset: { version: '2.0' } })
  assert.deepEqual(pixel(await render(empty, { ...options, background: [1, 1, 1, 0.5], toneMapping: 'reinhard' })), [188, 188, 188, 128])
  assert.deepEqual(pixel(await render(meshGlb([surface]), { ...options, exposure: -1 })), [188, 188, 188, 255])
})

test('material extension payloads and incompatible combinations fail clearly', async () => {
  for (const [extensions, message] of [
    [{ KHR_materials_emissive_strength: { emissiveStrength: -1 } }, /emissiveStrength/],
    [{ KHR_materials_emissive_strength: { emissiveStrength: 'bright' } }, /emissiveStrength/],
    [{ KHR_materials_emissive_strength: { emissiveStrength: 1e100 } }, /emissiveStrength/],
    [{ KHR_materials_unlit: true }, /KHR_materials_unlit/],
    [{ KHR_materials_unlit: {}, KHR_materials_emissive_strength: {} }, /cannot combine/],
  ])
    await assert.rejects(render(packGlb({ asset: { version: '2.0' }, materials: [{ extensions }] }), options), message)
})
