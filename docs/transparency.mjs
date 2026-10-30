/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { boxGeometry } from '../scripts/glb.mjs'
import { framed } from './model.mjs'

export function transparencyScene() {
  return framed([
    { name: 'cyan-shell', geometry: boxGeometry([-0.5, 0.45, 0], [0.95, 0.9, 0.9]), color: [0.1, 0.8, 0.9, 0.25], roughness: 0.25, alphaMode: 'BLEND', doubleSided: true },
    { name: 'amber-shell', geometry: boxGeometry([0.15, 0.45, 0.2], [0.95, 0.9, 0.9]), color: [1, 0.5, 0.1, 0.3], roughness: 0.25, alphaMode: 'BLEND', doubleSided: true },
    { name: 'emitter', geometry: boxGeometry([-0.5, 0.35, 0], [0.18, 0.6, 0.18]), color: [0, 0, 0, 1], emissive: [0.15, 0.6, 1], emissiveStrength: 3, roughness: 1 },
    { name: 'unlit-marker', geometry: boxGeometry([1, 0.3, 0], [0.35, 0.6, 0.35]), color: [0.8, 0.2, 0.4, 1], unlit: true },
    { name: 'floor', geometry: boxGeometry([0, -0.04, 0], [2.8, 0.08, 1.8]), color: [0.6, 0.63, 0.67, 1], roughness: 1 },
  ])
}
