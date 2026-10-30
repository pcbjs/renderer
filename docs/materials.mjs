/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { boxGeometry } from '../scripts/glb.mjs'
import { framed } from './model.mjs'
import { rgba } from './texture.mjs'

function sphere(x) {
  const columns = 48
  const rows = 32
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  for (let y = 0; y <= rows; y++) {
    for (let column = 0; column <= columns; column++) {
      const theta = (y / rows) * Math.PI
      const phi = (column / columns) * 2 * Math.PI
      const normal = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]
      positions.push(x + normal[0] * 0.36, 0.38 + normal[1] * 0.36, normal[2] * 0.36)
      normals.push(...normal)
      uvs.push(column / columns, y / rows)
    }
  }
  for (let y = 0; y < rows; y++)
    for (let column = 0; column < columns; column++) {
      const a = y * (columns + 1) + column
      const b = a + columns + 1
      if (y > 0) indices.push(a, a + 1, b)
      if (y < rows - 1) indices.push(a + 1, b + 1, b)
    }
  return { positions, normals, uvs, uvs1: uvs.map((v, i) => (i % 2 ? v : 1 - v)), indices }
}

const mipmapped = image => ({ ...image, sampler: { magFilter: 9729, minFilter: 9987 } })

export function materialsScene() {
  const roughness = mipmapped(rgba(64, 32, x => [255, x % 16 < 8 ? 45 : 220, 255]))
  const normal = mipmapped(
    rgba(64, 64, (x, y) => {
      const nx = 0.4 * Math.sin((x * Math.PI) / 4)
      const ny = 0.3 * Math.cos((y * Math.PI) / 4)
      const nz = Math.sqrt(1 - nx * nx - ny * ny)
      return [nx, ny, nz].map(v => Math.round((v + 1) * 127.5))
    }),
  )
  const checks = mipmapped(rgba(64, 64, (x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? [235, 192, 92] : [60, 105, 90])))
  const occlusion = { ...mipmapped(rgba(32, 32, (_x, y) => [100 + 155 * (1 - y / 31), 255, 255])), texCoord: 1 }
  return framed([
    { name: 'roughness', geometry: sphere(-0.9), color: [0.9, 0.57, 0.3, 1], metallic: 1, roughness: 1, metallicRoughnessTexture: roughness },
    { name: 'normal', geometry: sphere(0), color: [0.25, 0.5, 0.8, 1], metallic: 0, roughness: 0.35, normalTexture: normal },
    {
      name: 'uv-and-occlusion',
      geometry: sphere(0.9),
      color: [1, 1, 1, 1],
      metallic: 0,
      roughness: 0.65,
      texture: { ...checks, transform: { rotation: Math.PI / 6, scale: [2, 1], offset: [0.1, 0] } },
      occlusionTexture: occlusion,
    },
    { name: 'floor', geometry: boxGeometry([0, -0.035, 0], [2.9, 0.07, 1.5]), color: [0.65, 0.67, 0.7, 1], roughness: 1 },
  ])
}
