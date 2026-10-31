/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, OptionError } from '../dist/index.mjs'
import { meshGlb, packGlb, boxGeometry } from '../scripts/glb.mjs'

const surface = { name: 'surface', unlit: true, doubleSided: true, color: [1, 0, 0, 1], geometry: boxGeometry([0, 0, 0], [2, 2, 0.2]) }
const opts = { width: 120, height: 80, supersample: 2, background: 'transparent' }
const fit = { type: 'fit', direction: [0, 0, 1] }
function edit(glb, change) {
  const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)))
  change(json)
  return packGlb(json, glb.subarray(28 + length))
}
const corners = bounds => Array.from({ length: 8 }, (_, n) => bounds.min.map((v, axis) => (n & (1 << axis) ? bounds.max[axis] : v)))
const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`)

test('bounds share selection and translation rules and preserve empty results', async () => {
  const glb = edit(meshGlb([surface, { ...surface, geometry: boxGeometry([10, 0, 0], [2, 2, 2]) }]), json => {
    json.nodes.push({ name: 'group', children: [0] }, { name: 'empty' })
    json.scenes[0].nodes = [1, 2, 3]
  })
  const r = await createRenderer(glb)
  try {
    const original = r.bounds()
    assert.equal(original.max[0], 11)
    assert.deepEqual(r.bounds({ nodes: ['surface'] }), original)
    const options = {
      nodes: ['group'],
      nodeTranslations: [
        { node: 2, translation: [2, 3, 4] },
        { node: 0, translation: [1, 0, 0] },
      ],
    }
    const bounds = r.bounds(options)
    close(bounds.min[0], 2)
    close(bounds.max[1], 4)
    close(bounds.min[2], 3.9)
    const a = await r.render({ ...opts, camera: { ...fit, nodes: ['group'] }, nodeTranslations: options.nodeTranslations })
    const b = await r.render({ ...opts, camera: { ...fit, bounds }, nodeTranslations: options.nodeTranslations })
    assert.deepEqual(a.rgba, b.rgba)
    for (const options of [{ nodes: [] }, { nodes: ['empty'] }, { nodes: [0], visibility: { hidden: ['group'] } }, { visibility: { only: [] } }])
      assert.equal(r.bounds(options), null)
    bounds.min[0] = 99
    assert.deepEqual(r.bounds(), original)
    assert.throws(
      () => r.bounds({ nodes: ['absent'] }),
      e => e instanceof OptionError && e.path === 'nodes[0]',
    )
  } finally {
    r.dispose()
  }
  assert.throws(() => r.bounds(), /disposed/)
  assert.throws(() => r.prepare(opts), /disposed/)
})

test('resolved frames replay fit and explicit cameras byte for byte', async () => {
  const r = await createRenderer(meshGlb([surface]))
  try {
    for (const camera of [
      fit,
      { ...fit, direction: [0, 0, -1] },
      { ...fit, projection: 'orthographic' },
      { ...fit, direction: [0, 1, 0], up: [0, 0, -1] },
      { type: 'perspective', position: [3, 2, 4], target: [0, 0, 0], fov: 50 },
      { type: 'orthographic', position: [3, 2, 4], target: [0, 0, 0], height: 4 },
    ]) {
      const frame = r.prepare({ width: opts.width, height: opts.height, camera })
      const image = await r.render({ ...opts, camera, includeFrame: true })
      assert.deepEqual(image.frame, frame)
      assert.deepEqual((await r.render({ ...opts, ...JSON.parse(JSON.stringify(frame)) })).rgba, image.rgba)
      const [centre] = r.project(frame, [[0, 0, 0]])
      close(centre.x, 60)
      close(centre.y, 40)
      assert.equal(centre.clipped, false)
    }
    assert.equal('frame' in (await r.render(opts)), false)
  } finally {
    r.dispose()
  }
})

test('authored projection and infinite far survive JSON replay and camera translation', async () => {
  for (const camera of [
    { type: 'perspective', perspective: { yfov: 0.8, znear: 0.1, aspectRatio: 2.5 } },
    { type: 'orthographic', orthographic: { xmag: 3, ymag: 2, znear: 0, zfar: 100 } },
  ]) {
    const glb = edit(meshGlb([surface]), json => {
      json.cameras = [camera]
      json.nodes.push({ camera: 0, translation: [0, 0, 4] })
      json.scenes[0].nodes.push(1)
    })
    const r = await createRenderer(glb)
    try {
      const input = { ...opts, camera: { type: 'asset', node: 1 }, nodeTranslations: [{ node: 1, translation: [0, 0, 1] }], includeFrame: true }
      const image = await r.render(input)
      const frame = JSON.parse(JSON.stringify(image.frame))
      assert.equal(frame.camera.state.position[2], 5)
      if (camera.type === 'perspective') assert.equal(frame.camera.state.far, null)
      assert.deepEqual((await r.render({ ...input, ...frame })).rgba, image.rgba)
    } finally {
      r.dispose()
    }
  }
})

test('asymmetric padding fits within the viewport and projection matches output pixels', async () => {
  const r = await createRenderer(meshGlb([surface]))
  try {
    for (const projection of ['perspective', 'orthographic'])
      for (const [width, height] of [
        [180, 100],
        [80, 240],
      ]) {
        const padding = { top: 13, right: 7, bottom: 21, left: 31 }
        const camera = { ...fit, projection, padding, margin: 1.08 }
        const frame = r.prepare({ width, height, camera })
        for (const p of r.project(frame, corners(r.bounds()))) {
          assert.ok(p.x >= padding.left - 1e-4 && p.x <= width - padding.right + 1e-4)
          assert.ok(p.y >= padding.top - 1e-4 && p.y <= height - padding.bottom + 1e-4)
        }
        const [centre] = r.project(frame, [[0, 0, 0]])
        close(centre.x, (width + padding.left - padding.right) / 2)
        close(centre.y, (height + padding.top - padding.bottom) / 2)
        for (const supersample of [1, 3]) {
          const image = await r.render({ ...opts, width, height, supersample, camera, includeFrame: true })
          assert.deepEqual(image.frame, frame)
          const i = (Math.floor(centre.y) * width + Math.floor(centre.x)) * 4
          assert.equal(image.rgba[i + 3], 255)
          const projected = r.project(frame, corners(r.bounds()))
          const covered = []
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (image.rgba[(y * width + x) * 4 + 3]) covered.push([x + 0.5, y + 0.5])
          for (const [axis, key] of [
            [0, 'x'],
            [1, 'y'],
          ]) {
            close(Math.min(...covered.map(p => p[axis])), Math.min(...projected.map(p => p[key])), 1)
            close(Math.max(...covered.map(p => p[axis])), Math.max(...projected.map(p => p[key])), 1)
          }
          assert.deepEqual((await r.render({ ...opts, ...frame, supersample })).rgba, image.rgba)
        }
      }
    assert.deepEqual((await r.render({ ...opts, camera: fit })).rgba, (await r.render({ ...opts, camera: { ...fit, padding: {} } })).rgba)
  } finally {
    r.dispose()
  }
})

test('projection reports clipping without promising occlusion and validates frame input', async () => {
  const r = await createRenderer(meshGlb([surface]))
  try {
    const frame = r.prepare({ width: 100, height: 100, camera: { type: 'perspective', position: [0, 0, 4], target: [0, 0, 0], near: 1, far: 10 } })
    const points = r.project(frame, [
      [0, 0, 0],
      [0, 0, 3.5],
      [0, 0, 5],
      [100, 0, 0],
      [0, 0, -20],
    ])
    assert.deepEqual(
      points.map(p => p.clipped),
      [false, true, true, true, true],
    )
    assert.equal(points[2].behind, true)
    assert.equal(points[2].x, null)
    assert.equal(points[0].depth, 4)
    for (const padding of [{ left: -1 }, { top: NaN }, { left: 100 }, { bottom: Infinity }, { typo: 1 }])
      assert.throws(() => r.prepare({ width: 100, height: 100, camera: { ...fit, padding } }), OptionError)
    const broken = structuredClone(frame)
    broken.camera.state.right = [2, 0, 0]
    assert.throws(() => r.project(broken, [[0, 0, 0]]), OptionError)
    assert.throws(() => r.project(frame, [[NaN, 0, 0]]), OptionError)
    assert.throws(() => r.project(frame, Array(1)), OptionError)
    assert.throws(() => r.prepare({ ...opts, camera: fit }), /unknown prepare option/)
    assert.deepEqual(r.project(frame, []), [])
  } finally {
    r.dispose()
  }
})

test('padded flat and point fits retain translated context and camera orientation', async () => {
  const flat = { ...surface, geometry: { positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], indices: [0, 1, 2, 0, 2, 3] } }
  const r = await createRenderer(meshGlb([flat, { ...surface, name: 'context', geometry: boxGeometry([0, 0, -5], [8, 8, 0.1]) }]))
  try {
    const nodeTranslations = [{ node: 0, translation: [3, 2, 1] }]
    for (const projection of ['perspective', 'orthographic']) {
      const frame = r.prepare({ width: 100, height: 80, nodeTranslations, camera: { ...fit, projection, nodes: [0], padding: { left: 20, bottom: 10 } } })
      const [centre, right, up] = r.project(frame, [
        [3, 2, 1],
        [4, 2, 1],
        [3, 3, 1],
      ])
      close(centre.x, 60)
      close(centre.y, 35)
      assert.ok(right.x > centre.x)
      assert.ok(up.y < centre.y)
      assert.deepEqual(frame.camera.state.forward, [0, 0, -1])
      const image = await r.render({ ...opts, ...frame, nodeTranslations })
      assert.deepEqual(
        image.rgba,
        (await r.render({ ...opts, width: 100, height: 80, nodeTranslations, camera: { ...fit, projection, nodes: [0], padding: { left: 20, bottom: 10 } } })).rgba,
      )
      const point = r.prepare({ width: 100, height: 80, camera: { ...fit, projection, bounds: { min: [3, 2, 1], max: [3, 2, 1] }, padding: { left: 20 } } })
      const [p] = r.project(point, [[3, 2, 1]])
      assert.equal(p.clipped, false)
      close(p.x, 60, 0.01)
    }
  } finally {
    r.dispose()
  }
})
