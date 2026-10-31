/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateBytes } from 'gltf-validator'
import { createRenderer, render } from '../dist/index.mjs'
import { meshGlb, packGlb } from '../scripts/glb.mjs'

const geometry = { positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], normals: Array(4).fill([0, 0, 1]).flat(), indices: [0, 1, 2, 0, 2, 3] }
const options = {
  width: 1,
  height: 1,
  supersample: 1,
  background: 'transparent',
  light: { ambient: 0 },
  camera: { type: 'orthographic', position: [0, 0, 2], target: [0, 0, 0], height: 2 },
}
const surface = { name: 'surface', geometry, color: [1, 1, 1, 1], metallic: 0, roughness: 1 }
const pixel = result => [...result.rgba.slice(0, 4)]
function unpack(glb) {
  const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true)
  return [JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length))), glb.subarray(28 + length)]
}
function edit(glb, change) {
  const [json, bin] = unpack(glb)
  change(json)
  return packGlb(json, bin)
}
function lit(light, transform = {}) {
  return edit(meshGlb([surface]), json => {
    json.extensionsUsed = json.extensionsRequired = ['KHR_lights_punctual']
    json.extensions = { KHR_lights_punctual: { lights: [light] } }
    json.nodes.push({ ...transform, extensions: { KHR_lights_punctual: { light: 0 } } })
    json.scenes[0].nodes.push(1)
  })
}

test('linear colour factors are the default, with an explicit legacy load option', async () => {
  const glb = meshGlb([{ ...surface, color: [0.5, 0.25, 0.125, 1], unlit: true }])
  assert.deepEqual(pixel(await render(glb, options)), [188, 137, 99, 255])
  assert.deepEqual(pixel(await render(glb, options, { baseColorSpace: 'srgb' })), [128, 64, 32, 255])
  const textured = meshGlb([{ ...surface, color: [0.5, 0.5, 0.5, 1], unlit: true, texture: { w: 1, h: 1, rgba: new Uint8Array([128, 128, 128, 255]) } }])
  assert.deepEqual(pixel(await render(textured, options)), [92, 92, 92, 255])
})

test('scene selection, metadata, node indices and parent translations are independent of extras', async () => {
  const glb = edit(meshGlb([{ ...surface, unlit: true }]), json => {
    json.nodes[0].extras = { explode: 'application-owned', label: 42 }
    json.nodes.push({ name: 'group', children: [0] })
    json.scenes = [
      { name: 'empty', nodes: [] },
      { name: 'model', nodes: [1] },
    ]
  })
  const renderer = await createRenderer(glb, { scene: 1 })
  try {
    assert.equal(renderer.info.scene, 1)
    assert.equal(renderer.info.nodes.find(n => n.index === 0).parent, 1)
    assert.equal(renderer.info.nodes.find(n => n.index === 0).extras.explode, 'application-owned')
    assert.equal(pixel(await renderer.render(options))[3], 255)
    assert.equal(pixel(await renderer.render({ ...options, nodeTranslations: [{ node: 1, translation: [3, 0, 0] }] }))[3], 0)
    assert.deepEqual(pixel(await renderer.render({ ...options, highlight: { nodes: [1], dim: 1 } })), [255, 204, 51, 255])
    const info = renderer.info
    info.nodes.length = 0
    assert.equal(renderer.info.nodes.length, 2)
    await assert.rejects(renderer.render({ ...options, nodeTranslations: [{ node: 90, translation: [0, 0, 0] }] }), /outside the selected scene/)
  } finally {
    renderer.dispose()
  }
  assert.equal(pixel(await render(glb, options))[3], 0)
  await assert.rejects(createRenderer(glb, { scene: 2 }), /scene 2/)
})

test('unsupported content has structured diagnostics and a strict load policy', async () => {
  const glb = edit(meshGlb([surface]), json => {
    json.extensionsUsed = ['VENDOR_optional']
    json.animations = [{}]
    json.nodes[0].skin = 0
    json.meshes[0].primitives[0].targets = [{}]
    json.meshes[0].primitives.push({ attributes: json.meshes[0].primitives[0].attributes, mode: 1 })
  })
  const result = await render(glb, options)
  assert.deepEqual(result.diagnostics.map(d => d.code).sort(), ['unsupported-animation', 'unsupported-extension', 'unsupported-morph', 'unsupported-skin', 'unsupported-topology'])
  await assert.rejects(createRenderer(glb, { unsupported: 'error' }), /Skin deformation/)
})

test('authored cameras honor node transforms, clip planes, and aspect ratio', async () => {
  const make = camera =>
    edit(meshGlb([{ ...surface, unlit: true }]), json => {
      json.cameras = [camera]
      json.nodes.push({ name: 'camera', camera: 0, translation: [0, 0, 2] })
      json.scenes[0].nodes.push(1)
    })
  const ortho = make({ type: 'orthographic', orthographic: { xmag: 1, ymag: 1, znear: 0, zfar: 3 } })
  const renderer = await createRenderer(ortho)
  try {
    assert.deepEqual(renderer.info.cameras, [1])
    assert.deepEqual(pixel(await renderer.render({ ...options, camera: { type: 'asset', node: 1 } })), [255, 255, 255, 255])
    assert.deepEqual(pixel(await renderer.render({ ...options, camera: { type: 'asset', node: 1 }, visibility: { only: [0], hidden: [1] } })), [255, 255, 255, 255])
    assert.equal(pixel(await renderer.render({ ...options, camera: { type: 'asset', node: 1 }, nodeTranslations: [{ node: 1, translation: [3, 0, 0] }] }))[3], 0)
    await assert.rejects(renderer.render({ ...options, camera: { type: 'asset', node: 0 } }), /camera node 0/)
  } finally {
    renderer.dispose()
  }
  const far = make({ type: 'perspective', perspective: { yfov: Math.PI / 2, znear: 0.1, zfar: 1 } })
  assert.equal(pixel(await render(far, { ...options, camera: { type: 'asset', node: 1 } }))[3], 0)
  for (const aspectRatio of [undefined, 1]) {
    const glb = make({ type: 'perspective', perspective: { yfov: Math.PI / 2, znear: 0.1, aspectRatio } })
    const image = await render(glb, { ...options, width: 40, height: 20, camera: { type: 'asset', node: 1 } })
    const coverage = image.rgba.filter((v, i) => i % 4 === 3 && v > 0).length
    assert.equal(coverage, aspectRatio ? 200 : 100)
  }
})

test('punctual lights use authored units, inverse-square falloff, range, colour and transforms', async () => {
  const directional = lit({ type: 'directional', color: [1, 0, 0], intensity: Math.PI })
  assert.deepEqual(pixel(await render(directional, options)), [255, 0, 0, 255])
  assert.deepEqual(pixel(await render(directional, { ...options, visibility: { only: [0], hidden: [1] } })), [255, 0, 0, 255])
  const point = lit({ type: 'point', intensity: Math.PI }, { translation: [0, 0, 2], scale: [5, 5, 5] })
  assert.deepEqual(pixel(await render(point, options)), [137, 137, 137, 255])
  assert.deepEqual(pixel(await render(point, { ...options, nodeTranslations: [{ node: 1, translation: [0, 0, -1] }] })), [255, 255, 255, 255])
  assert.deepEqual(pixel(await render(lit({ type: 'point', intensity: 100, range: 1 }, { translation: [0, 0, 2] }), options)), [0, 0, 0, 255])
  assert.deepEqual(pixel(await render(directional, { ...options, lights: [] })), [0, 0, 0, 255])
  const flipped = lit({ type: 'directional', intensity: Math.PI }, { rotation: [0, 1, 0, 0] })
  assert.deepEqual(pixel(await render(flipped, options)), [0, 0, 0, 255])
  const report = await validateBytes(point, { writeTimestamp: false })
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages))
})

test('spot cones fade smoothly and multiple lights add independently', async () => {
  const glb = meshGlb([surface])
  const spot = { type: 'spot', position: [0, 0, 1], direction: [0, 0, -1], intensity: Math.PI, innerConeAngle: 0.2, outerConeAngle: 0.6 }
  const shade = async angle => pixel(await render(glb, { ...options, lights: [{ ...spot, direction: [Math.sin(angle), 0, -Math.cos(angle)] }] }))[0]
  assert.equal(await shade(0), 255)
  assert.equal(await shade(0.7), 0)
  assert.ok((await shade(0.4)) > 0 && (await shade(0.4)) < 255)
  assert.deepEqual(
    pixel(
      await render(glb, {
        ...options,
        lights: [
          { type: 'directional', direction: [0, 0, -1], intensity: Math.PI, color: [1, 0, 0] },
          { type: 'directional', direction: [0, 0, -1], intensity: Math.PI, color: [0, 1, 0] },
        ],
      }),
    ),
    [255, 255, 0, 255],
  )
})

test('API validates unknown options, light parameters and load choices', async () => {
  const glb = meshGlb([surface])
  for (const [change, message] of [
    [{ view: 'iso' }, /unknown render option: view/],
    [{ explode: 1 }, /unknown render option: explode/],
    [{ camera: { type: 'fit', direction: [0, 0, 0] } }, /non-zero/],
    [{ camera: { ...options.camera, near: 2, far: 1 } }, /clipping/],
    [{ lights: [{ type: 'point', position: [0, 0, 1], intensity: -1 }] }, /intensity/],
    [{ lights: [{ type: 'spot', position: [0, 0, 1], direction: [0, 0, -1], innerConeAngle: 1, outerConeAngle: 0.5 }] }, /spot angles/],
    [{ nodeTranslations: [{ node: -1, translation: [0, 0, 0] }] }, /non-negative/],
  ])
    await assert.rejects(render(glb, { ...options, ...change }), message)
  for (const load of [{ scene: -1 }, { baseColorSpace: 'auto' }, { unsupported: 'ignore' }]) await assert.rejects(createRenderer(glb, load))
  for (const [change, message] of [
    [
      json => {
        json.asset.minVersion = '2.1'
      },
      /minVersion/,
    ],
    [
      json => {
        json.materials[0].pbrMetallicRoughness.baseColorFactor = [-1, 0, 0, 1]
      },
      /baseColorFactor/,
    ],
    [
      json => {
        json.materials[0].pbrMetallicRoughness.metallicFactor = 2
      },
      /metallicFactor/,
    ],
  ])
    await assert.rejects(createRenderer(edit(glb, change)), message)
})

test('missing normals render hard edges and ignore supplied tangents', async () => {
  const positions = [-1, -1, 0, 1, -1, 0, 0, 1, 0, 0, 0, 1]
  const indices = [0, 1, 2, 0, 3, 1]
  const uvs = [0, 0, 1, 0, 0.5, 1, 0.5, 1]
  const normalTexture = { w: 1, h: 1, rgba: new Uint8Array([128, 128, 255, 255]) }
  const implicit = meshGlb([{ ...surface, normalTexture, geometry: { positions, indices, uvs, tangents: Array(4).fill([0, 1, 0, -1]).flat() } }])
  const n = Math.SQRT1_2
  const explicit = meshGlb([
    {
      ...surface,
      normalTexture,
      geometry: {
        positions: indices.flatMap(i => positions.slice(i * 3, i * 3 + 3)),
        indices: [0, 1, 2, 3, 4, 5],
        uvs: indices.flatMap(i => uvs.slice(i * 2, i * 2 + 2)),
        normals: [...Array(3).fill([0, 0, 1]).flat(), ...Array(3).fill([0, n, -n]).flat()],
      },
    },
  ])
  const opts = { ...options, width: 64, height: 64, camera: { type: 'perspective', position: [1, 3, 4], target: [0, 0, 0] }, lighting: 'studio' }
  assert.deepEqual((await render(implicit, opts)).rgba, (await render(explicit, opts)).rgba)
})
