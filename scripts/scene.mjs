/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { boxGeometry, meshGlb } from './glb.mjs'

export function cubeGlb() {
  return meshGlb([{ name: 'board', geometry: boxGeometry([0, 0, 0], [0.02, 0.02, 0.02]), color: [0.2, 0.45, 0.85, 1], roughness: 1 }])
}

export function partGlb() {
  return meshGlb([
    { name: 'board', geometry: boxGeometry([0, 0, 0], [0.04, 0.004, 0.03]), color: [0.35, 0.38, 0.32, 1], roughness: 1 },
    { name: 'part:U1', geometry: boxGeometry([0, 0.006, 0], [0.012, 0.008, 0.012]), color: [0.85, 0.18, 0.14, 1], roughness: 1, explode: [0, 0.01, 0] },
  ])
}
