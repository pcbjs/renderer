import { inflateSync } from 'node:zlib'

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

export function decodePng(input) {
  const png = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (png[0] !== 137 || png[1] !== 80 || png[2] !== 78 || png[3] !== 71) throw new Error('not a PNG')
  let off = 8
  let width = 0
  let height = 0
  const idat = []
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off)
    const type = png.subarray(off + 4, off + 8).toString('ascii')
    const data = png.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6) throw new Error('PNG is not 8-bit RGBA')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const out = Buffer.alloc(stride * height)
  let i = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[i++]
    const row = y * stride
    const prev = y === 0 ? -1 : (y - 1) * stride
    for (let x = 0; x < stride; x++) {
      const v = raw[i++]
      const a = x >= 4 ? out[row + x - 4] : 0
      const b = prev < 0 ? 0 : out[prev + x]
      const c = prev < 0 || x < 4 ? 0 : out[prev + x - 4]
      const add = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : NaN
      if (Number.isNaN(add)) throw new Error(`PNG filter ${filter}`)
      out[row + x] = (v + add) & 255
    }
  }
  return { width, height, rgba: out }
}
