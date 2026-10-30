/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer } from '../dist/index.mjs'
import { cubeGlb } from '../scripts/scene.mjs'

test('invalid render options fail with actionable errors and leave the scene usable', async () => {
  const renderer = await createRenderer(cubeGlb())
  try {
    for (const [options, message] of [
      [{ exposure: NaN }, /finite/],
      [{ typo: true }, /unknown render option: typo/],
      [{ exposure: 21 }, /stops/],
      [{ toneMapping: 'filmic' }, /toneMapping/],
      [{ transparency: true }, /options object/],
      [{ transparency: { maxLayers: 0 } }, /positive integer/],
      [{ transparency: { maxLayers: 129 } }, /1 and 128/],
      [{ transparency: { maxLayers: 1.5 } }, /integer/],
      [{ lighting: 'pbr' }, /lighting/],
      [{ shadows: 1 }, /shadows/],
      [{ shadows: [] }, /shadows/],
      [{ shadows: { resolution: 128 } }, /256 and 2048/],
      [{ shadows: { resolution: 2049 } }, /256 and 2048/],
      [{ shadows: { resolution: 512.5 } }, /integer/],
      [{ shadows: { strength: 2 } }, /between 0 and 1/],
      [{ shadows: { strength: NaN } }, /finite/],
      [{ width: 0 }, /positive integer/],
      [{ supersample: 9 }, /outside 1 to 8/],
      [{ width: 4096, supersample: 3 }, /8192/],
      [{ light: { direction: [0, 0, 0] } }, /non-zero/],
      [{ light: { direction: new Array(3) } }, /three finite numbers/],
      [{ background: new Array(4) }, /four finite numbers/],
      [{ camera: { type: 'perspective', position: [0, 0, 0], target: [0, 0, 0] } }, /same point/],
      [{ camera: { type: 'perspective', position: [0, 0, 1], target: [0, 0, 0], fov: 179 } }, /fov/],
      [{ camera: { type: 'orthographic', position: [0, 0, 1] } }, /height/],
      [{ camera: { type: 'orthographic', position: [0, 0, 1], target: [0, 0, 0], height: 0 } }, /positive/],
      [{ camera: 3 }, /camera must/],
      [{ highlight: { nodes: [undefined] } }, /names or non-negative/],
    ]) {
      await assert.rejects(renderer.render({ width: 8, height: 8, ...options }), message)
    }
    await assert.rejects(renderer.render([]), /render options must be an object/)
    assert.equal((await renderer.render({ width: 8, height: 8 })).rgba.length, 256)
  } finally {
    renderer.dispose()
  }
})
