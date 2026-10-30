/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(buf: Uint8Array): number {
  let a = 1
  let b = 0
  for (let start = 0; start < buf.length; start += 4096) {
    const end = Math.min(start + 4096, buf.length)
    for (let i = start; i < end; i++) {
      a += buf[i]
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

function deflateStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4)
  const view = new DataView(out.buffer)
  out.set([0x78, 0x01])
  let offset = 2
  for (let block = 0; block < blocks; block++) {
    const start = block * 65535
    const length = Math.min(65535, raw.length - start)
    out[offset] = block === blocks - 1 ? 1 : 0
    view.setUint16(offset + 1, length, true)
    view.setUint16(offset + 3, length ^ 0xffff, true)
    out.set(raw.subarray(start, start + length), offset + 5)
    offset += 5 + length
  }
  view.setUint32(offset, adler32(raw))
  return out
}

async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof process !== 'undefined' && process.env?.PCBJS_PNG_STORED === '1') return deflateStored(raw)
  try {
    const zlib = await import('node:zlib')
    return zlib.deflateSync(raw)
  } catch {
    return deflateStored(raw)
  }
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export async function encodePng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error(`PNG size ${width} by ${height} is not a positive integer`)
  if (rgba.length !== width * height * 4) throw new Error(`PNG expected ${width * height * 4} bytes of RGBA, got ${rgba.length}`)
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1)
    raw[row] = 0
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), row + 1)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const z = await deflate(raw)
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  return concat([sig, chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array())])
}
