/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InspectionWorker } from '../examples/worker-client.mjs'
import { createRenderer, RendererError, serializeError } from '../dist/index.mjs'
import { meshGlb, boxGeometry } from '../scripts/glb.mjs'
const glb = meshGlb([{ name: 'cube', geometry: boxGeometry([0, 0, 0], [1, 1, 1]), color: [1, 0, 0, 1] }])
const opts = { width: 64, height: 64, outputs: { depth: true, nodeIds: true }, includeFrame: true }

test('worker reuses scenes, transfers outputs and preserves the old scene after failed replacement', async () => {
  const worker = new InspectionWorker()
  const direct = await createRenderer(glb)
  try {
    await worker.replace(glb)
    assert.ok(glb.byteLength)
    const a = await worker.request('render', opts)
    assert.deepEqual(a, await direct.render(opts))
    assert.deepEqual(await worker.request('bounds', {}), direct.bounds())
    const frame = await worker.request('prepare', { width: 64, height: 64 })
    assert.deepEqual(await worker.request('project', frame, [[0, 0, 0]]), direct.project(frame, [[0, 0, 0]]))
    await assert.rejects(worker.replace(new Uint8Array([1, 2, 3])), error => error.code === 'ASSET_INVALID' && error.recoverable)
    await assert.rejects(worker.request('render', { ...opts, width: 0 }), error => error.code === 'INVALID_OPTION' && error.path === 'width')
    assert.deepEqual((await worker.request('render', opts)).rgba, a.rgba)
    await worker.replace(glb)
    assert.deepEqual((await worker.request('render', opts)).rgba, a.rgba)
  } finally {
    await worker.dispose()
    direct.dispose()
  }
  await assert.rejects(worker.request('bounds'), /terminated|disposed/)
})

test('worker bounds the queue and termination rejects outstanding work', async () => {
  const worker = new InspectionWorker({ maxQueue: 1 })
  const request = worker.replace(glb)
  await assert.rejects(worker.replace(glb), /queue is full/)
  await request
  const running = worker.request('render', { width: 2048, height: 2048, supersample: 4 })
  const rejected = assert.rejects(running, /terminated|disposed/)
  await worker.dispose()
  await rejected
})

test('core errors have serializable codes without leaking stacks', async () => {
  await assert.rejects(createRenderer(new Uint8Array(0)), e => e instanceof RendererError && e.code === 'ASSET_INVALID')
  const renderer = await createRenderer(glb)
  renderer.dispose()
  try {
    renderer.bounds()
  } catch (error) {
    const record = serializeError(error)
    assert.equal(record.code, 'DISPOSED')
    assert.equal(record.recoverable, false)
    assert.equal('stack' in record, false)
    assert.deepEqual(structuredClone(record), record)
  }
})

test('worker replaces a trapped runtime, reloads the cached scene and retries only once', async () => {
  for (const always of [false, true]) {
    const counts = new SharedArrayBuffer(8)
    const worker = new InspectionWorker({ url: new URL('./fixtures/failing-worker.mjs', import.meta.url), workerData: { counts, always } })
    try {
      await worker.replace(glb)
      if (always) await assert.rejects(worker.request('render', opts), e => e.code === 'WASM_TRAP')
      else assert.equal(await worker.request('render', opts), 'ok')
      assert.deepEqual([...new Int32Array(counts)], [2, 2])
    } finally {
      await worker.dispose()
    }
  }
})
