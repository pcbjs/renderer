import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, encodePng, render } from '../dist/index.mjs'
import { boxGeometry, meshGlb } from '../scripts/glb.mjs'
import { cubeGlb, partGlb } from '../scripts/scene.mjs'
import { pi5Scene as moduleScene } from '../docs/model.mjs'
import { decodePng } from './png.mjs'

const shot = { width: 64, height: 48, supersample: 1 }

test('a shot has the requested size and round-trips through PNG', async () => {
  const { rgba, width, height } = await render(cubeGlb(), { ...shot, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] } })
  assert.equal(width, 64)
  assert.equal(height, 48)
  assert.equal(rgba.length, 64 * 48 * 4)
  const back = decodePng(await encodePng(rgba, width, height))
  assert.equal(Buffer.compare(back.rgba, rgba), 0)
  assert.ok(
    rgba.some((v, i) => i % 4 === 3 && v === 255),
    'the cube covers some pixels',
  )
})

test('the same scene rendered twice is byte identical, and a second camera is not', async () => {
  const scene = await createRenderer(cubeGlb())
  try {
    assert.equal(scene.triangles, 12)
    const a = await scene.render({ ...shot, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] } })
    const b = await scene.render({ ...shot, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] } })
    const top = await scene.render({ ...shot, camera: { type: 'fit', direction: [0, 1, 0.001] } })
    assert.deepEqual(a.rgba, b.rgba)
    assert.notDeepEqual(a.rgba, top.rgba)
  } finally {
    scene.dispose()
  }
})

test('highlight, node translations and a clear background each change the picture', async () => {
  const glb = partGlb()
  const plain = await render(glb, { ...shot, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] } })
  const hi = await render(glb, { ...shot, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] }, highlight: { nodes: ['part:U1'], dim: 0.75 } })
  const exploded = await render(glb, { ...shot, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] }, nodeTranslations: [{ node: 1, translation: [0, 0.01, 0] }] })
  const clear = await render(glb, { ...shot, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] }, background: 'transparent' })
  assert.notDeepEqual(plain.rgba, hi.rgba)
  assert.notDeepEqual(plain.rgba, exploded.rgba)
  assert.equal(clear.rgba[3], 0)
  let outline = 0
  for (let i = 0; i < hi.rgba.length; i += 4) if (hi.rgba[i] === 255 && hi.rgba[i + 1] === 204 && hi.rgba[i + 2] === 51) outline++
  assert.ok(outline > 0)
})

test('the back of a flat board is a full face', async () => {
  const board = meshGlb([{ name: 'board', geometry: boxGeometry([0, 0.0006, 0], [0.06, 0.0012, 0.04]), color: [0.72, 0.64, 0.45, 1], roughness: 1 }])
  const opts = { width: 80, height: 60, supersample: 1, background: 'transparent' }
  const count = rgba => {
    let n = 0
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 10) n++
    return n
  }
  const top = count((await render(board, { ...opts, camera: { type: 'fit', direction: [0, 1, 0.001] } })).rgba)
  const bottom = count((await render(board, { ...opts, camera: { type: 'fit', direction: [0, -1, -0.001] } })).rgba)
  assert.ok(bottom > top * 0.85, `bottom covers ${bottom} pixels, top covers ${top}`)
})

test('the docs module renders', async () => {
  const { rgba, width, height } = await render(moduleScene().glb, shot)
  assert.equal(width, 64)
  assert.equal(height, 48)
  assert.equal(rgba.length, 64 * 48 * 4)
  assert.ok(
    rgba.some((v, i) => i % 4 === 3 && v === 255),
    'the module covers some pixels',
  )
})

test('metal keeps its colour under ambient and hemisphere light away from a specular highlight', async () => {
  const geometry = {
    positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
  }
  const opts = {
    width: 8,
    height: 8,
    supersample: 1,
    camera: { type: 'orthographic', position: [0, 0, 2], target: [0, 0, 0], height: 2 },
  }
  for (const roughness of [0.25, 1]) {
    const glb = meshGlb([{ name: 'metal', geometry, color: [0.886, 0.698, 0.29, 1], metallic: 1, roughness }])
    for (const detail of [false, true]) {
      for (const light of [{ ambient: 0.25 }, { ambient: 0, hemisphere: 0.5 }]) {
        const { rgba } = await render(glb, { ...opts, detail, light: { direction: [0, 1, 0], ...light } })
        const [r, g, b, a] = rgba.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)
        assert.ok(r > 100 && r > g && g > b && b > 20, `metal stays gold: ${[r, g, b]}, roughness ${roughness}, detail ${detail}`)
        assert.equal(a, 255)
      }
      const { rgba } = await render(glb, { ...opts, detail, light: { direction: [0, 1, 0], ambient: 0 } })
      assert.deepEqual([...rgba.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)], [0, 0, 0, 255], 'unlit metal stays dark')
    }
  }
})

test('disposing a renderer is idempotent and further access fails clearly', async () => {
  const renderer = await createRenderer(cubeGlb())
  await renderer.render(shot)
  renderer.dispose()
  renderer.dispose()
  await assert.rejects(renderer.render(shot), /disposed/)
  assert.throws(() => renderer.triangles, /disposed/)
})

test('transparent supersampled edges retain straight-alpha colour', async () => {
  const geometry = { positions: [-0.8, -0.8, 0, 0.8, -0.8, 0, 0, 0.8, 0], indices: [0, 1, 2] }
  const glb = meshGlb([{ name: 'white', geometry, color: [1, 1, 1, 1], metallic: 0, roughness: 1 }])
  const { rgba } = await render(glb, {
    width: 16,
    height: 16,
    supersample: 2,
    background: 'transparent',
    light: { ambient: 1 },
    camera: { type: 'orthographic', position: [0, 0, 2], target: [0, 0, 0], height: 2 },
  })
  let edges = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0 && rgba[i + 3] < 255) {
      assert.deepEqual([...rgba.slice(i, i + 3)], [255, 255, 255])
      edges++
    }
  }
  assert.ok(edges > 0)
})
