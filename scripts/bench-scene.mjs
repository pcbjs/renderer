/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { meshGlb } from './glb.mjs'

function grid(n) {
  const verts = n + 1
  const positions = []
  const normals = []
  const indices = []
  for (let y = 0; y < verts; y++) {
    for (let x = 0; x < verts; x++) {
      positions.push(-1 + (2 * x) / n, 0, -1 + (2 * y) / n)
      normals.push(0, 1, 0)
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * verts + x
      indices.push(i, i + verts, i + 1, i + 1, i + verts, i + verts + 1)
    }
  }
  return { positions, normals, indices }
}

export function gridGlb(n) {
  return meshGlb([{ name: 'grid', geometry: grid(n), color: [0.7, 0.72, 0.74, 1], roughness: 1 }])
}

export function cellsFor(triangles) {
  let n = 1
  while (2 * n * n < triangles) n++
  return n
}
