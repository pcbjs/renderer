/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { Worker } from 'node:worker_threads'
import { RendererError, type Renderer, type LoadOptions, type AssetInfo, type ErrorRecord } from './index.js'

export interface WorkerScene {
  info: AssetInfo
  triangles: number
}
type SceneInput = [glb: Uint8Array | ArrayBuffer, options?: LoadOptions]
type QueryMethod = 'render' | 'bounds' | 'prepare' | 'project' | 'edges'
export type WorkerArguments = { load: SceneInput; replace: SceneInput } & { [M in QueryMethod]: Parameters<Renderer[M]> }
export type WorkerResults = { load: WorkerScene; replace: WorkerScene } & { [M in QueryMethod]: Awaited<ReturnType<Renderer[M]>> }
export type WorkerMethod = keyof WorkerArguments
export type WorkerRequest = { [M in WorkerMethod]: { id: number; method: M; args: WorkerArguments[M] } }[WorkerMethod]
export type WorkerResponse = { id: number } & ({ result: WorkerResults[WorkerMethod]; error?: never } | { error: ErrorRecord; result?: never })
export interface RendererWorkerOptions {
  url?: URL
  workerData?: unknown
}

export class RendererWorker {
  #worker: Worker
  #id = 0
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  #closed = false
  #termination?: Promise<number>

  constructor({ url = new URL('./worker-runtime.mjs', import.meta.url), workerData }: RendererWorkerOptions = {}) {
    this.#worker = new Worker(url, { workerData })
    this.#worker.on('message', (message: WorkerResponse) => {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      if (message.error) pending.reject(Object.assign(new Error(message.error.message), message.error))
      else pending.resolve(message.result)
    })
    this.#worker.on('error', error => this.#close(error))
    this.#worker.on('exit', code => this.#close(new RendererError('DISPOSED', 'worker', `worker exited (${code})`, false)))
  }

  #close(error: Error) {
    this.#closed = true
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }

  request<M extends WorkerMethod>(method: M, args: WorkerArguments[M], transfer: readonly ArrayBuffer[] = []): Promise<WorkerResults[M]> {
    if (this.#closed) return Promise.reject(new RendererError('DISPOSED', method, 'worker has been terminated', false))
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve: value => resolve(value as WorkerResults[M]), reject })
      try {
        this.#worker.postMessage({ id, method, args }, [...transfer])
      } catch (error) {
        this.#pending.delete(id)
        reject(error)
      }
    })
  }

  load(glb: Uint8Array | ArrayBuffer, options?: LoadOptions, transfer?: readonly ArrayBuffer[]) {
    return this.request('load', [glb, options], transfer)
  }
  replace(glb: Uint8Array | ArrayBuffer, options?: LoadOptions, transfer?: readonly ArrayBuffer[]) {
    return this.request('replace', [glb, options], transfer)
  }
  render(...args: WorkerArguments['render']) {
    return this.request('render', args)
  }
  bounds(...args: WorkerArguments['bounds']) {
    return this.request('bounds', args)
  }
  prepare(...args: WorkerArguments['prepare']) {
    return this.request('prepare', args)
  }
  project(...args: WorkerArguments['project']) {
    return this.request('project', args)
  }
  edges(...args: WorkerArguments['edges']) {
    return this.request('edges', args)
  }
  terminate(): Promise<number> {
    this.#close(new RendererError('DISPOSED', 'terminate', 'worker has been terminated', false))
    return (this.#termination ??= this.#worker.terminate())
  }
}
