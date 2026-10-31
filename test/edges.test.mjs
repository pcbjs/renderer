/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer } from '../dist/index.mjs'
import { meshGlb, boxGeometry } from '../scripts/glb.mjs'

test('sharp edges weld faceted vertices, exclude coplanar diagonals and follow visibility and translation', async () => {
  const r = await createRenderer(meshGlb([{ name: 'cube', geometry: boxGeometry([0, 0, 0], [1, 1, 1]), color: [1, 1, 1, 1] }]))
  try {
    assert.equal(r.edges().length, 12)
    assert.equal(r.edges({ angle: 100 }).length, 0)
    assert.equal(r.edges({ nodes: [] }).length, 0)
    assert.equal(r.edges({ visibility: { hidden: ['cube'] } }).length, 0)
    const translated = r.edges({ nodeTranslations: [{ node: 0, translation: [0, 0, 2] }] })
    assert.ok(translated.every(e => e.start[2] >= 1.5 && e.end[2] >= 1.5))
    const opts = { width: 128, height: 96, camera: { type: 'fit', direction: [1, 1, 1] } }
    const base = await r.render(opts)
    const edged = await r.render({ ...opts, edges: { color: [1, 0, 0, 1], width: 1.5, depthBias: 0.00001 } })
    assert.notDeepEqual(base.rgba, edged.rgba)
    assert.deepEqual((await r.render(opts)).rgba, base.rgba)
    assert.throws(() => r.edges({ angle: -1 }), /angle/)
  } finally {
    r.dispose()
  }
})
