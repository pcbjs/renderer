/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Bin, packGlb } from '../scripts/glb.mjs'

export const referenceManifest = JSON.parse(await readFile(new URL('./reference-assets.json', import.meta.url), 'utf8'))
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export async function referenceAsset(name) {
  const bytes = await readFile(new URL(`./fixtures/${name}.gltf`, import.meta.url))
  const json = JSON.parse(bytes)
  const bin = new Bin()
  const offsets = (json.buffers ?? []).map(buffer => {
    if (!buffer.uri?.startsWith('data:') || !buffer.uri.includes(';base64,')) throw new Error(`${name}: fixture buffers must be embedded base64`)
    const data = Buffer.from(buffer.uri.split(',')[1], 'base64')
    if (data.length !== buffer.byteLength) throw new Error(`${name}: buffer byteLength mismatch`)
    bin.align(4)
    return bin.add(data)
  })
  for (const view of json.bufferViews ?? []) {
    view.byteOffset = offsets[view.buffer] + (view.byteOffset ?? 0)
    view.buffer = 0
  }
  json.buffers = [{ byteLength: bin.length }]
  return { bytes, json, glb: packGlb(json, bin.bytes()) }
}
