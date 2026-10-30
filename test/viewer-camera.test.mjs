/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { transform } from 'esbuild'

const source = await readFile(new URL('../docs/camera.ts', import.meta.url), 'utf8')
const { code } = await transform(source, { loader: 'ts', format: 'esm' })
const camera = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('viewer presets preserve extension-view directions after the glTF coordinate conversion', () => {
  for (const [preset, [x, y, z]] of [
    ['iso', [0.55, -0.95, 0.9]],
    ['top', [0, -0.001, 1]],
    ['bottom', [0, 0.001, -1]],
    ['front', [0, -1, 0]],
  ]) {
    const { azimuth, elevation } = camera.viewAngles(preset)
    const actual = [Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)]
    const expected = [x, z, -y].map(value => value / Math.hypot(x, y, z))
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-10, `${preset} axis ${index}`))
  }
})
