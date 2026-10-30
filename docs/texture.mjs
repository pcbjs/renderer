function noise(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return n - Math.floor(n)
}

export function rgba(w, h, pixel) {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = pixel(x, y, w, h)
      const i = (y * w + x) * 4
      out[i] = c[0]
      out[i + 1] = c[1]
      out[i + 2] = c[2]
      out[i + 3] = 255
    }
  }
  return { w, h, rgba: out }
}

export function maskTexture() {
  return rgba(128, 96, (x, y, w, h) => {
    const n = noise(x * 0.35, y * 0.35)
    const weave = ((x + y) & 3) === 0 ? 8 : 0
    return [18 + n * 18 + weave, 92 + n * 28, 58 + n * 14]
  })
}

export function escTexture() {
  return rgba(128, 128, (x, y) => {
    const n = noise(x * 0.5, y * 0.5)
    const copper = noise(x * 0.08, y * 0.15) > 0.9
    if (copper) return [150 + n * 30, 78, 42]
    return [16 + n * 8, 17 + n * 6, 16 + n * 6]
  })
}

export function ceramicTexture() {
  return rgba(128, 128, (x, y, w, h) => {
    const u = x / w
    const v = y / h
    const n = noise(x * 0.7, y * 0.7)
    const band = v > 0.42 && v < 0.58
    const spot = noise(x * 0.15, y * 0.15) > 0.82
    if (band) return [30, 70 + n * 30, 150]
    if (spot) return [196, 84, 42]
    return [236 + n * 14, 226 + n * 12, 208 + n * 10]
  })
}

export function furTexture() {
  return rgba(128, 128, (x, y) => {
    const n = noise(x * 0.85, y * 1.3)
    const streak = Math.abs(Math.sin(x * 0.45 + noise(0, y) * 2))
    const light = n > 0.72 || streak > 0.92
    const r = 150 + n * 40 + (light ? 40 : 0)
    const g = 118 + n * 28 + (light ? 30 : 0)
    const b = 96 + n * 16
    return [r, g, b]
  })
}
