/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { readFile } from 'node:fs/promises'
import init, { Scene } from '../build/pkg/renderer.js'

let started: Promise<void> | undefined

export function loadWasm(): Promise<void> {
  started ??= (async () => {
    const bytes = await readFile(new URL('./renderer_bg.wasm', import.meta.url))
    await init({ module_or_path: bytes })
  })().catch(error => {
    started = undefined
    throw error
  })
  return started
}

export { Scene }
