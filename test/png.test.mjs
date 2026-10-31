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

test('PNG tEXt preserves multiple Latin-1 metadata entries and valid chunk CRCs', async () => {
  const { crc32 } = await import('node:zlib')
  const rgba = new Uint8Array([20, 40, 60, 255])
  const text = { Snapshot: 'revision-123', Legend: 'Cu: signal\nCaf\u00e9', Empty: '' }
  const png = Buffer.from(await encodePng(rgba, 1, 1, text))
  const decoded = {},
    types = []
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at),
      type = png.toString('ascii', at + 4, at + 8)
    types.push(type)
    assert.equal(png.readUInt32BE(at + 8 + length), crc32(png.subarray(at + 4, at + 8 + length)))
    if (type === 'tEXt') {
      const data = png.subarray(at + 8, at + 8 + length),
        zero = data.indexOf(0)
      decoded[data.toString('latin1', 0, zero)] = data.toString('latin1', zero + 1)
    }
    at += length + 12
  }
  assert.deepEqual(decoded, text)
  assert.deepEqual(types, ['IHDR', 'tEXt', 'tEXt', 'tEXt', 'IDAT', 'IEND'])
  assert.deepEqual(new Uint8Array(decodePng(png).rgba), rgba)
  assert.deepEqual(await encodePng(rgba, 1, 1), await encodePng(rgba, 1, 1, {}))
})

test('PNG metadata rejects invalid keywords, unrepresentable text and NUL bytes', async () => {
  for (const text of [
    null,
    [],
    { '': 'x' },
    { ['x'.repeat(80)]: 'x' },
    { ' padded': 'x' },
    { 'two  spaces': 'x' },
    { 'bad\0key': 'x' },
    { Key: 'bad\0text' },
    { Key: '\u4e2d' },
    { Key: 1 },
  ])
    await assert.rejects(encodePng(new Uint8Array(4), 1, 1, text), /PNG text/)
})
