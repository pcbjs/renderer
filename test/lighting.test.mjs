/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { render } from '../dist/index.mjs'
import { meshGlb, packGlb } from '../scripts/glb.mjs'

const geometry = {
  positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  uvs: [0, 1, 1, 1, 1, 0, 0, 0],
  indices: [0, 1, 2, 0, 2, 3],
}
const options = {
  width: 16,
  height: 16,
  supersample: 1,
  background: 'transparent',
  camera: { type: 'orthographic', position: [0, 0, 2], target: [0, 0, 0], height: 2 },
  light: { ambient: 0, direction: [0, 1, 0] },
}
const pixel = rgba => [...rgba.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)]
const node = { name: 'surface', geometry, color: [0, 0, 0, 1], metallic: 0, roughness: 1 }

test('emissive factor is linear, independent of lighting, and uses the existing highlight mix', async () => {
  const glb = meshGlb([
    { ...node, emissive: [0.21404114, 0, 0] },
    { ...node, name: 'other', geometry: { ...geometry, positions: geometry.positions.map((v, i) => (i % 3 === 0 ? v + 4 : v)) } },
  ])
  for (const lighting of ['classic', 'studio']) {
    const { rgba } = await render(glb, { ...options, lighting, shadows: true })
    assert.deepEqual(pixel(rgba), [128, 0, 0, 255])
    const dimmed = await render(glb, { ...options, lighting, highlight: { nodes: ['other'], dim: 1 } })
    assert.deepEqual(pixel(dimmed.rgba), [0, 0, 0, 0])
  }
})

test('emissive textures decode sRGB, ignore texture alpha, and require an emissive factor', async () => {
  const emissiveTexture = { w: 1, h: 1, rgba: new Uint8Array([128, 64, 32, 0]) }
  const glb = meshGlb([{ ...node, emissive: [1, 1, 1], emissiveTexture }])
  assert.deepEqual(pixel((await render(glb, options)).rgba), [128, 64, 32, 255])
  const dark = meshGlb([{ ...node, emissiveTexture }])
  assert.deepEqual(pixel((await render(dark, options)).rgba), [0, 0, 0, 255])
  const masked = meshGlb([{ ...node, emissive: [1, 1, 1], emissiveTexture, alphaMode: 'MASK', color: [0, 0, 0, 0] }])
  assert.deepEqual(pixel((await render(masked, options)).rgba), [0, 0, 0, 0])
})

test('emissive texture indices and coordinate sets are validated', async () => {
  for (const [material, textures, message] of [
    [{ emissiveTexture: { index: 2 } }, [], /missing texture/],
    [{ emissiveFactor: [-1, 0, 0] }, [], /emissiveFactor/],
    [{ emissiveFactor: [0, 0] }, [], /3/],
  ]) {
    const glb = packGlb({ asset: { version: '2.0' }, materials: [material], textures })
    await assert.rejects(render(glb, options), message)
  }
  const glb = meshGlb([{ ...node, emissiveTexture: { w: 1, h: 1, rgba: new Uint8Array([255, 0, 0, 255]) } }])
  const view = new DataView(glb.buffer)
  const length = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)))
  json.materials[0].emissiveTexture.texCoord = 1
  await assert.rejects(render(packGlb(json, glb.subarray(28 + length)), options), /TEXCOORD_1/)
})

test('studio metal reflects the environment and roughness changes direct highlights', async () => {
  for (const roughness of [0, 0.2, 0.6, 1]) {
    const glb = meshGlb([{ ...node, color: [0.886, 0.698, 0.29, 1], metallic: 1, roughness }])
    const { rgba } = await render(glb, { ...options, lighting: 'studio', light: { direction: [0, 1, 0], ambient: 0.25 } })
    const [r, g, b, a] = pixel(rgba)
    assert.ok(r > g && g > b && b > 10, `roughness ${roughness}: ${[r, g, b]}`)
    assert.equal(a, 255)
    assert.deepEqual(pixel((await render(glb, { ...options, lighting: 'studio' })).rgba), [0, 0, 0, 255])
  }
  const shade = async roughness =>
    pixel(
      (
        await render(meshGlb([{ ...node, color: [0.3, 0.3, 0.3, 1], metallic: 1, roughness }]), {
          ...options,
          lighting: 'studio',
          light: { ambient: 0, direction: [0, 0, 1] },
        })
      ).rgba,
    )[0]
  assert.ok((await shade(0.3)) > (await shade(0.8)) + 60)
})
