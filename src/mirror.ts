/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import type { ProjectedPoint, ResolvedFrame } from './options.js'

export function mirrorPixels(pixels: Uint8Array | Float32Array | Uint32Array, width: number, height: number, channels = 1) {
  for (let y = 0; y < height; y++)
    for (let x = 0; x < Math.floor(width / 2); x++)
      for (let c = 0; c < channels; c++) {
        const left = (y * width + x) * channels + c,
          right = (y * width + width - 1 - x) * channels + c,
          value = pixels[left]
        pixels[left] = pixels[right]
        pixels[right] = value
      }
}

export function mirrorPoints(points: ProjectedPoint[], frame: ResolvedFrame) {
  if (frame.mirror) for (const point of points) if (point.x !== null) point.x = frame.width - point.x
  return points
}
