/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, render, OptionError } from '../dist/index.mjs'
import { meshGlb, packGlb } from '../scripts/glb.mjs'

function quad(name, x, z, size, color) {
  return {
    name,
    color,
    unlit: true,
    doubleSided: true,
    roughness: 1,
    geometry: { positions: [x - size, -size, z, x + size, -size, z, x + size, size, z, x - size, size, z], indices: [0, 1, 2, 0, 2, 3] },
  }
}
function hierarchy(glb) {
  const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)))
  json.nodes.push({ name: 'group', children: [0] }, { name: 'empty' })
  json.scenes[0].nodes = [1, 2, 3]
  return packGlb(json, glb.subarray(28 + length))
}
const target = quad('target', 0, 0, 0.1, [1, 0, 0, 1])
const distant = quad('context', 10, 0, 1, [0, 0, 1, 1])
const scene = () => hierarchy(meshGlb([target, distant]))
const opts = { width: 64, height: 64, supersample: 2, background: 'transparent' }
const camera = { type: 'fit', direction: [0, 0, 1] }
const colors = (image, channel) => image.rgba.filter((v, i) => i % 4 === channel && v > 200).length

test('fit selections use descendant bounds and translated geometry without changing the scene', async () => {
  const renderer = await createRenderer(scene())
  try {
    const all = await renderer.render({ ...opts, camera })
    const focused = await renderer.render({ ...opts, camera: { ...camera, nodes: ['group'] } })
    assert.ok(colors(focused, 0) > 2500)
    assert.ok(colors(all, 0) < 100)
    const bounds = await renderer.render({ ...opts, camera: { ...camera, bounds: { min: [-0.1, -0.1, 0], max: [0.1, 0.1, 0] } } })
    assert.deepEqual(focused.rgba, bounds.rgba)
    const moved = await renderer.render({ ...opts, camera: { ...camera, nodes: [2] }, nodeTranslations: [{ node: 2, translation: [2, 3, 0] }] })
    assert.deepEqual(focused.rgba, moved.rgba)
    assert.deepEqual((await renderer.render({ ...opts, camera })).rgba, all.rgba)
    assert.equal(renderer.triangles, 4)
  } finally {
    renderer.dispose()
  }
})

test('visibility filters descendants before fitting and hidden overrides only', async () => {
  const renderer = await createRenderer(scene())
  try {
    const expected = await render(meshGlb([target]), { ...opts, camera })
    const isolated = await renderer.render({ ...opts, camera, visibility: { only: ['group'] } })
    const hidden = await renderer.render({ ...opts, camera, visibility: { hidden: ['context'] } })
    assert.deepEqual(isolated.rgba, expected.rgba)
    assert.deepEqual(hidden.rgba, expected.rgba)
    for (const visibility of [{ only: [] }, { only: ['group'], hidden: [0] }, { only: [0], hidden: ['group'] }]) {
      const blank = await renderer.render({ ...opts, camera, visibility, shadows: true })
      assert.ok(blank.rgba.every(v => v === 0))
    }
    await assert.rejects(renderer.render({ ...opts, camera: { ...camera, nodes: ['group'] }, visibility: { hidden: [0] } }), /visible geometry/)
    await assert.rejects(renderer.render({ ...opts, camera: { ...camera, nodes: ['empty'] } }), /visible geometry/)
    assert.equal(renderer.info.nodes.length, 4)
  } finally {
    renderer.dispose()
  }
})

test('duplicate names select every matching node while numeric selectors disambiguate', async () => {
  const glb = meshGlb([
    { ...target, name: 'same' },
    { ...distant, name: 'same' },
  ])
  const renderer = await createRenderer(glb)
  try {
    const named = await renderer.render({ ...opts, camera, visibility: { only: ['same'] }, highlight: { nodes: ['same'] } })
    const indexed = await renderer.render({ ...opts, camera, visibility: { only: [0, 1] }, highlight: { nodes: [0, 1] } })
    assert.deepEqual(named.rgba, indexed.rgba)
    const one = await renderer.render({ ...opts, camera, visibility: { only: [0] } })
    assert.equal(colors(one, 2), 0)
    assert.ok(colors(one, 0) > 2500)
  } finally {
    renderer.dispose()
  }
})

test('focused perspective and orthographic cameras retain surrounding depth', async () => {
  const glb = meshGlb([target, quad('behind', 0, -10, 10, [0, 1, 0, 1])])
  for (const projection of ['perspective', 'orthographic']) {
    const image = await render(glb, { ...opts, camera: { ...camera, projection, nodes: [0] } })
    assert.ok(colors(image, 0) > 2500)
    assert.ok(colors(image, 1) > 100, `${projection} must not far-clip context`)
  }
  const foreground = meshGlb([target, quad('in-front', 0.08, 5, 0.03, [0, 0, 1, 1])])
  const image = await render(foreground, { ...opts, camera: { ...camera, projection: 'orthographic', nodes: [0] } })
  assert.ok(colors(image, 2) > 100, 'orthographic camera must stand in front of visible context')
})

test('point bounds produce finite close-ups and bottom directions preserve orientation', async () => {
  const glb = meshGlb([target])
  for (const projection of ['perspective', 'orthographic']) {
    const image = await render(glb, { ...opts, camera: { ...camera, projection, bounds: { min: [0, 0, 0], max: [0, 0, 0] } } })
    assert.equal(colors(image, 0), 64 * 64)
  }
  const a = await render(glb, { ...opts, camera: { ...camera, nodes: [0] } })
  const b = await render(glb, { ...opts, camera: { ...camera, direction: [0, 0, -1], nodes: [0] } })
  assert.deepEqual(a.rgba, b.rgba)
})

test('nested options and unknown selectors report structured errors and preserve renderer usability', async () => {
  const renderer = await createRenderer(scene())
  try {
    for (const [patch, path, code = 'INVALID_OPTION'] of [
      [{ shadows: { resoluton: 512 } }, 'shadows.resoluton'],
      [{ detail: 'true' }, 'detail'],
      [{ light: { typo: 1 } }, 'light.typo'],
      [{ lights: [{ type: 'directional', direction: [0, 0, -1], position: [0, 0, 0] }] }, 'lights[0].position'],
      [{ visibility: { only: [undefined] } }, 'visibility.only'],
      [{ visibility: { hidden: ['absent'] } }, 'visibility.hidden[0]', 'UNKNOWN_NODE'],
      [{ highlight: { nodes: [999] } }, 'highlight.nodes[0]', 'UNKNOWN_NODE'],
      [{ camera: { ...camera, nodes: ['absent'] } }, 'camera.nodes[0]', 'UNKNOWN_NODE'],
      [{ camera: { ...camera, nodes: [] } }, 'camera.nodes'],
      [{ camera: { ...camera, nodes: [0], bounds: { min: [0, 0, 0], max: [1, 1, 1] } } }, 'camera'],
      [{ camera: { ...camera, bounds: { min: [1, 0, 0], max: [0, 1, 1] } } }, 'camera.bounds'],
      [{ camera: { type: 'orthographic', position: [0, 0, 2], target: [0, 0, 0], height: 1, nodes: [0] } }, 'camera.nodes'],
      [{ nodeTranslations: [{ node: 999, translation: [0, 0, 0] }] }, 'nodeTranslations[0].node', 'UNKNOWN_NODE'],
      [{ nodeTranslations: [null] }, 'nodeTranslations[0]'],
    ]) {
      await assert.rejects(renderer.render({ ...opts, ...patch }), error => error instanceof OptionError && error.path === path && error.code === code)
    }
    assert.equal((await renderer.render(opts)).rgba.length, 64 * 64 * 4)
  } finally {
    renderer.dispose()
  }
})
