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
const node = { name: 'surface', geometry, color: [1, 1, 1, 1], metallic: 0, roughness: 1 }
const options = {
  width: 16,
  height: 16,
  supersample: 1,
  background: 'transparent',
  camera: { type: 'orthographic', position: [0, 0, 2], target: [0, 0, 0], height: 2 },
  light: { ambient: 1, direction: [0, 0, 1] },
}
const texel = (...rgba) => ({ w: 1, h: 1, rgba: new Uint8Array(rgba) })
const pixel = (rgba, x = 8, y = 8) => [...rgba.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)]
const shot = async (material, opts = {}) => (await render(meshGlb([{ ...node, ...material }]), { ...options, ...opts })).rgba
function edit(glb, change) {
  const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)))
  change(json)
  return packGlb(json, glb.subarray(28 + length))
}

test('metallic and roughness maps use linear B and G channels and multiply factors in both lighting modes', async () => {
  for (const lighting of ['classic', 'studio']) {
    const opts = { lighting, light: { ambient: 0.25, direction: [1, 1, 1] } }
    const mapped = await shot({ metallic: 0.8, roughness: 0.9, metallicRoughnessTexture: texel(255, 128, 64, 0) }, opts)
    const factors = await shot({ metallic: (0.8 * 64) / 255, roughness: (0.9 * 128) / 255 }, opts)
    assert.deepEqual(mapped, factors)
  }
})

test('occlusion affects indirect lighting only, with strength, and does not dim emission', async () => {
  const occlusionTexture = texel(128, 0, 0, 0)
  assert.deepEqual(pixel(await shot({ occlusionTexture })), [188, 188, 188, 255])
  assert.deepEqual(pixel(await shot({ occlusionTexture, occlusionStrength: 0 })), [255, 255, 255, 255])
  assert.deepEqual(pixel(await shot({ occlusionTexture, occlusionStrength: 0.5 })), [225, 225, 225, 255])
  for (const lighting of ['classic', 'studio']) {
    const direct = { lighting, light: { ambient: 0, hemisphere: 0, direction: [0, 0, 1] } }
    assert.deepEqual(await shot({ occlusionTexture }, direct), await shot({}, direct))
    const unlit = { lighting, light: { ambient: 0.5, hemisphere: 0.5, direction: [0, 0, -1] } }
    assert.deepEqual(pixel(await shot({ occlusionTexture: texel(0, 255, 255, 255), emissive: [0.21404114, 0, 0] }, unlit)), [128, 0, 0, 255])
  }
})

test('one image can be shared by colour and data slots without sRGB contamination', async () => {
  const glb = edit(meshGlb([{ ...node, texture: texel(128, 128, 128, 255) }]), json => {
    json.materials[0].occlusionTexture = { index: 0 }
  })
  const { rgba } = await render(glb, options)
  const expectedLinear = (((128 / 255 + 0.055) / 1.055) ** 2.4 * 128) / 255
  const expected = Math.round((1.055 * expectedLinear ** (1 / 2.4) - 0.055) * 255)
  assert.deepEqual(pixel(rgba), [expected, expected, expected, 255])
})

test('normal maps use authored or MikkTSpace tangents, strength, and mirrored node transforms', async () => {
  const normalTexture = texel(255, 128, 128, 0)
  const opts = { light: { ambient: 0, direction: [1, 0, 0] } }
  const generated = await shot({ normalTexture }, opts)
  assert.ok(pixel(generated)[0] > 250)
  const authored = { ...geometry, tangents: Array(4).fill([1, 0, 0, -1]).flat() }
  assert.deepEqual(await shot({ normalTexture, geometry: authored }, opts), generated)
  assert.deepEqual(pixel(await shot({ normalTexture, normalScale: 0 }, opts)), [0, 0, 0, 255])
  for (const basis of [geometry, authored]) {
    const mirrored = { normalTexture, geometry: basis, scale: [-2, 1, 0.5] }
    assert.deepEqual(pixel(await shot(mirrored, opts)), [0, 0, 0, 255])
    assert.ok(pixel(await shot(mirrored, { light: { ambient: 0, direction: [-1, 0, 0] } }))[0] > 250)
  }
  const back = { camera: { type: 'orthographic', position: [0, 0, -2], target: [0, 0, 0], height: 2 }, light: { ambient: 0, direction: [-1, 0, 0] } }
  assert.ok(pixel(await shot({ normalTexture, doubleSided: true }, back))[0] > 250)
})

test('normal maps generate tangents from their selected UV set and handle degenerate UVs', async () => {
  const normalTexture = { ...texel(255, 128, 128, 255), texCoord: 1 }
  const opts = { light: { ambient: 0, direction: [1, 0, 0] } }
  const reversed = { ...geometry, uvs1: geometry.uvs.map((v, i) => (i % 2 ? v : 1 - v)) }
  assert.deepEqual(pixel(await shot({ normalTexture, geometry: reversed }, opts)), [0, 0, 0, 255])
  const degenerate = { ...geometry, uvs: Array(8).fill(0) }
  const result = await shot({ normalTexture: texel(128, 128, 255, 255), geometry: degenerate })
  assert.equal(pixel(result)[3], 255)
})

test('texture transforms select UV1, compose scale then rotation then offset, and work when required', async () => {
  const texture = { w: 2, h: 2, rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), sampler: { magFilter: 9728, minFilter: 9728 } }
  const g = { ...geometry, uvs: Array(4).fill([0.25, 0.25]).flat(), uvs1: Array(4).fill([0.25, 0.75]).flat() }
  assert.deepEqual(pixel(await shot({ geometry: g, texture })), [255, 0, 0, 255])
  const transformed = { ...texture, transform: { texCoord: 1, scale: [2, 1], rotation: Math.PI / 2, offset: [1, 0.25] } }
  const glb = edit(meshGlb([{ ...node, geometry: g, texture: transformed }]), json => {
    json.extensionsRequired = ['KHR_texture_transform']
  })
  assert.deepEqual(pixel((await render(glb, options)).rgba), [0, 0, 255, 255])
  await assert.rejects(
    render(
      edit(glb, json => {
        json.extensionsRequired.push('UNKNOWN_extension')
      }),
      options,
    ),
    /UNKNOWN_extension/,
  )
})

test('mipmapped minification averages a high-frequency texture in linear light', async () => {
  const rgba = new Uint8Array(64 * 64 * 4)
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) rgba.set([((x + y) % 2) * 255, ((x + y) % 2) * 255, ((x + y) % 2) * 255, 255], (y * 64 + x) * 4)
  const g = { ...geometry, uvs: geometry.uvs.map(v => v * 4 + 0.5 / 64) }
  const texture = { w: 64, h: 64, rgba, sampler: { magFilter: 9728, minFilter: 9987 } }
  const mipmapped = await shot({ geometry: g, texture })
  assert.deepEqual(pixel(mipmapped), [188, 188, 188, 255])
  const aliased = await shot({ geometry: g, texture: { ...texture, sampler: { magFilter: 9728, minFilter: 9728 } } })
  assert.notDeepEqual(mipmapped, aliased)
})

test('invalid material texture inputs are rejected clearly', async () => {
  const glb = meshGlb([{ ...node, normalTexture: texel(128, 128, 255, 255) }])
  for (const [change, message] of [
    [
      json => {
        json.materials[0].normalTexture.texCoord = 2
      },
      /TEXCOORD_2/,
    ],
    [
      json => {
        json.materials[0].normalTexture.texCoord = -1
      },
      /texCoord/,
    ],
    [
      json => {
        json.materials[0].normalTexture.scale = 'large'
      },
      /scale/,
    ],
    [
      json => {
        json.materials[0].occlusionTexture = { index: 0, strength: 2 }
      },
      /occlusion strength/,
    ],
    [
      json => {
        json.samplers[0].magFilter = 9987
      },
      /magFilter/,
    ],
    [
      json => {
        json.samplers[0].minFilter = 1
      },
      /minFilter/,
    ],
    [
      json => {
        json.materials[0].normalTexture.extensions = { KHR_texture_transform: { scale: [1] } }
      },
      /scale/,
    ],
    [
      json => {
        json.materials[0].normalTexture.extensions = { KHR_texture_transform: { rotation: 'angle' } }
      },
      /rotation/,
    ],
  ])
    await assert.rejects(render(edit(glb, change), options), message)
})
