/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { parentPort } from 'node:worker_threads'
import { createRenderer, RendererError, serializeError, type Renderer, type RenderResult } from './index.js'
import type { WorkerRequest } from './worker.js'

const port = parentPort!
let renderer: Renderer | undefined
let queue = Promise.resolve()
port.on('message', (request: WorkerRequest) => {
  queue = queue.then(async () => {
    try {
      let result: unknown
      if (request.method === 'load' || request.method === 'replace') {
        if (request.method === 'load' && renderer) throw new RendererError('ASSET_INVALID', 'load', 'a scene is already loaded; use replace')
        const next = await createRenderer(...request.args)
        renderer?.dispose()
        renderer = next
        result = { info: renderer.info, triangles: renderer.triangles }
      } else {
        if (!renderer) throw new RendererError('DISPOSED', request.method, 'no scene loaded', false)
        switch (request.method) {
          case 'render':
            result = await renderer.render(...request.args)
            break
          case 'bounds':
            result = renderer.bounds(...request.args)
            break
          case 'prepare':
            result = renderer.prepare(...request.args)
            break
          case 'project':
            result = renderer.project(...request.args)
            break
          case 'edges':
            result = renderer.edges(...request.args)
            break
          default:
            throw new Error('unknown worker method')
        }
      }
      const image = request.method === 'render' ? (result as RenderResult) : undefined
      const transfer = image ? ([image.rgba.buffer, ...(image.depth ? [image.depth.buffer] : []), ...(image.nodeIds ? [image.nodeIds.buffer] : [])] as ArrayBuffer[]) : []
      port.postMessage({ id: request.id, result }, transfer)
    } catch (error) {
      port.postMessage({ id: request.id, error: serializeError(error) })
    }
  })
})
