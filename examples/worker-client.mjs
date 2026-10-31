/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { RendererWorker } from '@pcbjs/renderer/worker'

export class InspectionWorker {
  #worker
  #tail = Promise.resolve()
  #count = 0
  #closed = false
  #cached
  constructor({ maxQueue = 8, timeout = 30000, url, workerData } = {}) {
    if (!Number.isInteger(maxQueue) || maxQueue < 1 || !Number.isFinite(timeout) || timeout <= 0) throw new Error('invalid worker limits')
    this.maxQueue = maxQueue
    this.timeout = timeout
    this.url = url
    this.workerData = workerData
  }
  #stop() {
    const worker = this.#worker
    this.#worker = undefined
    return worker?.terminate()
  }
  #send(request) {
    this.#worker ??= new RendererWorker({ url: this.url, workerData: this.workerData })
    const worker = this.#worker
    const timer = setTimeout(() => this.#stop(), this.timeout)
    return worker.request(request.method, request.method === 'replace' ? [request.glb, request.options] : request.args).finally(() => clearTimeout(timer))
  }
  request(method, ...args) {
    return this.#enqueue({ method, args })
  }
  replace(glb, options) {
    return this.#enqueue({ method: 'replace', glb, options })
  }
  #enqueue(request) {
    if (this.#closed) return Promise.reject(new Error('worker has been disposed'))
    if (this.#count >= this.maxQueue) return Promise.reject(new Error('worker queue is full'))
    const input = structuredClone(request)
    this.#count++
    const run = this.#tail
      .then(async () => {
        if (this.#closed) throw new Error('worker has been disposed')
        const attempt = async () => {
          if (!this.#worker && this.#cached && input.method !== 'replace') await this.#send(this.#cached)
          return this.#send(input)
        }
        for (let retry = 0; ; retry++) {
          try {
            return await attempt()
          } catch (error) {
            if (error.code !== 'WASM_TRAP') throw error
            await this.#stop()
            if (this.#closed) throw new Error('worker has been disposed')
            if (retry) throw error
          }
        }
      })
      .then(result => {
        if (input.method === 'replace') this.#cached = input
        return result
      })
      .finally(() => {
        this.#count--
      })
    this.#tail = run.catch(() => {})
    return run
  }
  async dispose() {
    this.#closed = true
    this.#cached = undefined
    await this.#stop()
    await this.#tail
  }
}
