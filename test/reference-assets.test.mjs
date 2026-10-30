/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateBytes, validateString } from 'gltf-validator'
import { createRenderer } from '../dist/index.mjs'
import { referenceAsset, referenceManifest, sha256 } from './reference-assets.mjs'

for (const asset of referenceManifest.assets) {
  test(`Khronos reference: ${asset.name}`, async () => {
    const { bytes, glb } = await referenceAsset(asset.name)
    assert.equal(sha256(bytes), asset.sha256, 'fixture differs from its pinned manifest')
    for (const report of [await validateString(bytes.toString(), { writeTimestamp: false }), await validateBytes(glb, { writeTimestamp: false })]) {
      assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages))
    }
    if (asset.diagnostics.length) await assert.rejects(createRenderer(glb, { unsupported: 'error' }), /ignored|skipped|unavailable/)
    const renderer = await createRenderer(glb, { unsupported: asset.diagnostics.length ? 'warn' : 'error' })
    try {
      assert.deepEqual([...new Set(renderer.info.diagnostics.map(d => d.code))].sort(), asset.diagnostics.toSorted())
      assert.ok(renderer.triangles > 0)
      for (const direction of [
        [0, 0, 1],
        [1, 1, 1],
      ]) {
        const options = { width: 128, height: 128, supersample: 1, camera: { type: 'fit', direction }, background: 'transparent', lighting: 'studio' }
        const first = await renderer.render(options)
        assert.equal(first.rgba.length, 128 * 128 * 4)
        assert.ok(
          first.rgba.some((v, i) => i % 4 === 3 && v > 0),
          'reference render must contain geometry',
        )
        assert.deepEqual((await renderer.render(options)).rgba, first.rgba, 'repeated renders must be deterministic')
      }
    } finally {
      renderer.dispose()
    }
  })
}
