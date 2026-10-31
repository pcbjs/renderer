/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { crc32 } from 'node:zlib'
import { createRenderer, encodePng, serializeError } from '../dist/index.mjs'
import { packGlb, meshGlb, boxGeometry } from '../scripts/glb.mjs'

async function imageGlb(width, height) {
  const png = Buffer.from(await encodePng(new Uint8Array(4), 1, 1))
  png.writeUInt32BE(width, 16)
  png.writeUInt32BE(height, 20)
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29)
  return packGlb({ asset: { version: '2.0' }, images: [{ uri: `data:image/png;base64,${png.toString('base64')}` }] })
}

test('oversized PNG headers return recoverable TEXTURE_LIMIT before decoding pixels', async () => {
  for (const [width, height] of [
    [4097, 1],
    [1, 4097],
    [0x7fffffff, 0x7fffffff],
  ]) {
    await assert.rejects(createRenderer(await imageGlb(width, height)), error => {
      const record = serializeError(error)
      assert.equal(record.code, 'TEXTURE_LIMIT')
      assert.equal(record.operation, 'load')
      assert.equal(record.recoverable, true)
      return true
    })
  }
  const r = await createRenderer(meshGlb([{ geometry: boxGeometry([0, 0, 0], [1, 1, 1]) }]))
  try {
    assert.equal((await r.render({ width: 16, height: 16 })).rgba.length, 1024)
  } finally {
    r.dispose()
  }
})
