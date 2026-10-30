import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodePng } from '../dist/index.mjs'
import { decodePng } from './png.mjs'

test('encodePng round-trips RGBA', async () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 40])
  const png = await encodePng(rgba, 2, 2)
  const back = decodePng(png)
  assert.equal(back.width, 2)
  assert.equal(back.height, 2)
  assert.equal(Buffer.compare(back.rgba, rgba), 0)
})

test('stored deflate blocks also round-trip', async () => {
  const previous = process.env.PCBJS_PNG_STORED
  process.env.PCBJS_PNG_STORED = '1'
  try {
    for (const [width, height] of [
      [8, 8],
      [257, 256],
    ]) {
      const rgba = new Uint8Array(width * height * 4)
      for (let i = 0; i < rgba.length; i++) rgba[i] = i & 255
      const png = await encodePng(rgba, width, height)
      assert.equal(Buffer.compare(decodePng(png).rgba, rgba), 0)
    }
  } finally {
    if (previous === undefined) delete process.env.PCBJS_PNG_STORED
    else process.env.PCBJS_PNG_STORED = previous
  }
})

test('a bad PNG size is rejected', async () => {
  await assert.rejects(encodePng(new Uint8Array(4), 0, 1), /positive integer/)
  await assert.rejects(encodePng(new Uint8Array(3), 1, 1), /expected 4 bytes/)
})
