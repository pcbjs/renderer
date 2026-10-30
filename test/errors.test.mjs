import assert from 'node:assert/strict'
import { test } from 'node:test'
import { render } from '../dist/index.mjs'
import { packGlb } from '../scripts/glb.mjs'
import { cubeGlb } from '../scripts/scene.mjs'

const cube = cubeGlb()

test('a truncated GLB names the problem', async () => {
  await assert.rejects(render(Buffer.from('glTF'), { width: 16, height: 16 }), /truncated/)
})

test('a missing accessor names the index', async () => {
  const glb = packGlb({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 5 } }] }],
  })
  await assert.rejects(render(glb, { width: 16, height: 16 }), /accessor 5/)
})

test('a required extension is rejected by name', async () => {
  const glb = packGlb({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'], scenes: [{ nodes: [] }] })
  await assert.rejects(render(glb, { width: 16, height: 16 }), /KHR_draco_mesh_compression/)
})

test('a chunk length past the GLB is named as truncated', async () => {
  const bytes = Buffer.alloc(20)
  bytes.writeUInt32LE(0x46546c67, 0)
  bytes.writeUInt32LE(2, 4)
  bytes.writeUInt32LE(20, 8)
  bytes.writeUInt32LE(0xfffffff0, 12)
  bytes.writeUInt32LE(0x4e4f534a, 16)
  await assert.rejects(render(bytes, { width: 16, height: 16 }), /truncated/)
})

test('a scene node that is not an index is rejected', async () => {
  const glb = packGlb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: ['part'] }] })
  await assert.rejects(render(glb, { width: 16, height: 16 }), /scene 0/)
})

test('scene nodes that are not an array are rejected', async () => {
  const glb = packGlb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: { bad: true } }] })
  await assert.rejects(render(glb, { width: 16, height: 16 }), /not an array/)
})

test('a scene with no node list still renders', async () => {
  const glb = packGlb({ asset: { version: '2.0' }, scenes: [{}] })
  const { rgba } = await render(glb, { width: 8, height: 8, supersample: 1 })
  assert.equal(rgba.length, 8 * 8 * 4)
})

test('an image past 4096 is rejected before rendering', async () => {
  await assert.rejects(render(cube, { width: 4097, height: 16 }), /4096 by 4096/)
})

test('an oversized accessor is rejected without allocating its declared count', async () => {
  const glb = packGlb(
    {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 0xffffffff }],
      bufferViews: [{ buffer: 0, byteLength: 12 }],
    },
    new Uint8Array(12),
  )
  await assert.rejects(render(glb, { width: 8, height: 8 }), /extends past its buffer view/)
})
