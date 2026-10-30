/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
const SUN: [number, number, number] = [-30, 100, 60]

function sub(a: readonly number[], b: readonly number[]) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function dot(a: readonly number[], b: readonly number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function cross(a: readonly number[], b: readonly number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function norm(a: readonly number[]) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
export function basis(position: readonly number[], target: readonly number[], up: readonly number[]) {
  const back = norm(sub(position, target))
  let right = cross(up, back)
  if (dot(right, right) < 1e-8) right = Math.abs(up[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  right = norm(right)
  return { right, up: norm(cross(back, right)), back }
}
export function sunViewOf(position: readonly number[], target: readonly number[], up: readonly number[]) {
  const b = basis(position, target, up)
  return [dot(SUN, b.right), dot(SUN, b.up), dot(SUN, b.back)] as [number, number, number]
}
export function sunWorld(position: readonly number[], target: readonly number[], up: readonly number[], view: [number, number, number]) {
  const b = basis(position, target, up)
  return [
    b.right[0] * view[0] + b.up[0] * view[1] + b.back[0] * view[2],
    b.right[1] * view[0] + b.up[1] * view[1] + b.back[1] * view[2],
    b.right[2] * view[0] + b.up[2] * view[1] + b.back[2] * view[2],
  ] as [number, number, number]
}

const DIRECTIONS = {
  iso: [0.55, 0.9, 0.95],
  top: [0, 1, 0.001],
  bottom: [0, -1, -0.001],
  front: [0, 0, 1],
} as const

export function isoAngles() {
  return viewAngles('iso')
}

export function viewAngles(view: keyof typeof DIRECTIONS) {
  const [x, y, z] = DIRECTIONS[view]
  return { azimuth: Math.atan2(x, z), elevation: Math.asin(y / Math.hypot(x, y, z)) }
}
