/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */

export class Bin {
  constructor() {
    this.parts = []
    this.length = 0
  }
  align(n) {
    const pad = (n - (this.length % n)) % n
    if (pad) {
      this.parts.push(new Uint8Array(pad))
      this.length += pad
    }
  }
  add(buf) {
    const offset = this.length
    this.parts.push(buf)
    this.length += buf.length
    return offset
  }
  f32(values) {
    this.align(4)
    const buf = new Uint8Array(values.length * 4)
    const view = new DataView(buf.buffer)
    for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i], true)
    return this.add(buf)
  }
  u16(values) {
    this.align(2)
    const buf = new Uint8Array(values.length * 2)
    const view = new DataView(buf.buffer)
    for (let i = 0; i < values.length; i++) view.setUint16(i * 2, values[i], true)
    return this.add(buf)
  }
  u32(values) {
    this.align(4)
    const buf = new Uint8Array(values.length * 4)
    const view = new DataView(buf.buffer)
    for (let i = 0; i < values.length; i++) view.setUint32(i * 4, values[i], true)
    return this.add(buf)
  }
  bytes() {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const part of this.parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }
}

export function packGlb(json, bin = new Uint8Array(0)) {
  const jb = new TextEncoder().encode(JSON.stringify(json))
  const jpad = (4 - (jb.length % 4)) % 4
  const bpad = (4 - (bin.length % 4)) % 4
  const total = 12 + 8 + jb.length + jpad + 8 + bin.length + bpad
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let o = 0
  const u32 = n => {
    view.setUint32(o, n, true)
    o += 4
  }
  u32(0x46546c67)
  u32(2)
  u32(total)
  u32(jb.length + jpad)
  u32(0x4e4f534a)
  out.set(jb, o)
  o += jb.length
  out.fill(0x20, o, o + jpad)
  o += jpad
  u32(bin.length + bpad)
  u32(0x004e4942)
  out.set(bin, o)
  return out
}

export function boxGeometry(center, size) {
  const h = size.map(s => s / 2)
  const [cx, cy, cz] = center
  const faces = [
    {
      n: [1, 0, 0],
      v: [
        [h[0], -h[1], -h[2]],
        [h[0], h[1], -h[2]],
        [h[0], h[1], h[2]],
        [h[0], -h[1], h[2]],
      ],
    },
    {
      n: [-1, 0, 0],
      v: [
        [-h[0], -h[1], h[2]],
        [-h[0], h[1], h[2]],
        [-h[0], h[1], -h[2]],
        [-h[0], -h[1], -h[2]],
      ],
    },
    {
      n: [0, 1, 0],
      v: [
        [-h[0], h[1], -h[2]],
        [-h[0], h[1], h[2]],
        [h[0], h[1], h[2]],
        [h[0], h[1], -h[2]],
      ],
    },
    {
      n: [0, -1, 0],
      v: [
        [-h[0], -h[1], h[2]],
        [-h[0], -h[1], -h[2]],
        [h[0], -h[1], -h[2]],
        [h[0], -h[1], h[2]],
      ],
    },
    {
      n: [0, 0, 1],
      v: [
        [-h[0], -h[1], h[2]],
        [h[0], -h[1], h[2]],
        [h[0], h[1], h[2]],
        [-h[0], h[1], h[2]],
      ],
    },
    {
      n: [0, 0, -1],
      v: [
        [h[0], -h[1], -h[2]],
        [-h[0], -h[1], -h[2]],
        [-h[0], h[1], -h[2]],
        [h[0], h[1], -h[2]],
      ],
    },
  ]
  const positions = []
  const normals = []
  const indices = []
  for (const face of faces) {
    const base = positions.length / 3
    for (const v of face.v) {
      positions.push(cx + v[0], cy + v[1], cz + v[2])
      normals.push(...face.n)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { positions, normals, indices }
}

export function meshGlb(nodes) {
  const bin = new Bin()
  const accessors = []
  const bufferViews = []
  const meshes = []
  const materials = []
  const images = []
  const textures = []
  const samplers = [{ wrapS: 10497, wrapT: 10497 }]
  const extensionsUsed = new Set()
  const accessor = (values, components, componentType = 5126) => {
    const offset = componentType === 5126 ? bin.f32(values) : componentType === 5125 ? bin.u32(values) : bin.u16(values)
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: values.length * (componentType === 5123 ? 2 : 4) })
    accessors.push({ bufferView: bufferViews.length - 1, componentType, count: values.length / components, type: components === 1 ? 'SCALAR' : `VEC${components}` })
    return accessors.length - 1
  }
  for (const node of nodes) {
    const g = node.geometry
    const attributes = { POSITION: accessor(g.positions, 3) }
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    for (let i = 0; i < g.positions.length; i++) {
      const axis = i % 3
      bounds.min[axis] = Math.min(bounds.min[axis], g.positions[i])
      bounds.max[axis] = Math.max(bounds.max[axis], g.positions[i])
    }
    Object.assign(accessors[attributes.POSITION], bounds)
    if (g.normals) attributes.NORMAL = accessor(g.normals, 3)
    if (g.colors) attributes.COLOR_0 = accessor(g.colors, 4)
    if (g.tangents) attributes.TANGENT = accessor(g.tangents, 4)
    if (g.uvs1) attributes.TEXCOORD_1 = accessor(g.uvs1, 2)
    const indices = accessor(g.indices, 1, g.indices.some(i => i > 65535) ? 5125 : 5123)
    const pbr = { baseColorFactor: node.color, metallicFactor: node.metallic ?? 0, roughnessFactor: node.roughness }
    const addTexture = source => {
      if (!source) return undefined
      const png = pngRgba(source.w, source.h, source.rgba)
      const at = bin.add(png)
      bufferViews.push({ buffer: 0, byteOffset: at, byteLength: png.length })
      images.push({ bufferView: bufferViews.length - 1, mimeType: 'image/png' })
      const sampler = source.sampler ? samplers.push(source.sampler) - 1 : 0
      textures.push({ source: images.length - 1, sampler })
      if (source.transform) extensionsUsed.add('KHR_texture_transform')
      return { index: textures.length - 1, texCoord: source.texCoord, ...(source.transform ? { extensions: { KHR_texture_transform: source.transform } } : {}) }
    }
    pbr.baseColorTexture = addTexture(node.texture)
    const emissiveTexture = addTexture(node.emissiveTexture)
    pbr.metallicRoughnessTexture = addTexture(node.metallicRoughnessTexture)
    const normalTexture = addTexture(node.normalTexture)
    const occlusionTexture = addTexture(node.occlusionTexture)
    if (normalTexture) normalTexture.scale = node.normalScale
    if (occlusionTexture) occlusionTexture.strength = node.occlusionStrength
    if (g.uvs || node.texture || node.emissiveTexture || node.metallicRoughnessTexture || node.normalTexture || node.occlusionTexture)
      attributes.TEXCOORD_0 = accessor(g.uvs ?? planarUv(g.positions), 2)
    meshes.push({ primitives: [{ attributes, indices, material: materials.length }] })
    const extensions = {}
    if (node.unlit) extensions.KHR_materials_unlit = {}
    if (node.emissiveStrength !== undefined) extensions.KHR_materials_emissive_strength = { emissiveStrength: node.emissiveStrength }
    for (const name of Object.keys(extensions)) extensionsUsed.add(name)
    materials.push({
      ...(Object.keys(extensions).length ? { extensions } : {}),
      ...(node.doubleSided ? { doubleSided: true } : {}),
      pbrMetallicRoughness: pbr,
      emissiveFactor: node.emissive,
      emissiveTexture,
      normalTexture,
      occlusionTexture,
      alphaMode: node.alphaMode,
      alphaCutoff: node.alphaCutoff,
    })
  }
  return packGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: nodes.map((_, i) => i) }],
      nodes: nodes.map((node, i) => ({ name: node.name, mesh: i, scale: node.scale, ...(node.explode ? { extras: { explode: node.explode } } : {}) })),
      meshes,
      materials,
      ...(images.length ? { images, textures, samplers } : {}),
      ...(extensionsUsed.size ? { extensionsUsed: [...extensionsUsed] } : {}),
      accessors,
      bufferViews,
      buffers: [{ byteLength: bin.length }],
    },
    bin.bytes(),
  )
}

function planarUv(positions) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i])
    maxX = Math.max(maxX, positions[i])
    minZ = Math.min(minZ, positions[i + 2])
    maxZ = Math.max(maxZ, positions[i + 2])
  }
  const sx = maxX - minX || 1
  const sz = maxZ - minZ || 1
  const uv = []
  for (let i = 0; i < positions.length; i += 3) uv.push((positions[i] - minX) / sx, (positions[i + 2] - minZ) / sz)
  return uv
}

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(type, 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

export function pngRgba(w, h, rgba) {
  const stride = w * 4
  const raw = new Uint8Array((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    const at = y * (stride + 1)
    raw[at] = 0
    raw.set(rgba.subarray(y * stride, y * stride + stride), at + 1)
  }
  let a = 1
  let b = 0
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521
    b = (b + a) % 65521
  }
  const adler = ((b << 16) | a) >>> 0
  const blocks = [new Uint8Array([0x78, 0x01])]
  for (let off = 0; off < raw.length;) {
    const n = Math.min(65535, raw.length - off)
    const last = off + n >= raw.length
    const block = new Uint8Array(5 + n)
    block[0] = last ? 1 : 0
    block[1] = n & 0xff
    block[2] = n >> 8
    const nlen = n ^ 0xffff
    block[3] = nlen & 0xff
    block[4] = nlen >> 8
    block.set(raw.subarray(off, off + n), 5)
    blocks.push(block)
    off += n
  }
  const tail = new Uint8Array(4)
  new DataView(tail.buffer).setUint32(0, adler)
  blocks.push(tail)
  const zlen = blocks.reduce((n, part) => n + part.length, 0)
  const z = new Uint8Array(zlen)
  let zAt = 0
  for (const part of blocks) {
    z.set(part, zAt)
    zAt += part.length
  }
  const ihdr = new Uint8Array(13)
  const ih = new DataView(ihdr.buffer)
  ih.setUint32(0, w)
  ih.setUint32(4, h)
  ihdr[8] = 8
  ihdr[9] = 6
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk(new Uint8Array([73, 72, 68, 82]), ihdr),
    chunk(new Uint8Array([73, 68, 65, 84]), z),
    chunk(new Uint8Array([73, 69, 78, 68]), new Uint8Array()),
  ]
  const png = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    png.set(part, at)
    at += part.length
  }
  return png
}
