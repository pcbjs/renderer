/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { parentPort, workerData } from 'node:worker_threads'
const counts = new Int32Array(workerData.counts)
parentPort.on('message', request => {
  const n = Atomics.add(counts, request.method === 'replace' ? 0 : 1, 1)
  if (request.method === 'render' && (n === 0 || workerData.always)) {
    parentPort.postMessage({ id: request.id, error: { name: 'RendererError', code: 'WASM_TRAP', operation: 'render', recoverable: false, message: 'injected trap' } })
  } else parentPort.postMessage({ id: request.id, result: 'ok' })
})
