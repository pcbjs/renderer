/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RendererWorker } from '@pcbjs/renderer/worker'
import { createRenderer } from '../dist/index.mjs'
import { boxGeometry, meshGlb } from '../scripts/glb.mjs'
const geometry = boxGeometry([0, 0, 0], [1, 1, 1])
const glb = meshGlb([{ name: 'cube', geometry }])
const options = { width: 32, height: 24, mirror: true, outputs: { depth: true, nodeIds: true }, includeFrame: true }

test('packaged worker handles typed geometry, FIFO load/render, atomic replacement and queries', async () => {
  const worker = new RendererWorker()
  const selectionGeometry = [{ id: 'item', positions: new Float32Array(geometry.positions), indices: new Uint32Array(geometry.indices) }]
  const direct = await createRenderer(glb, { selectionGeometry })
  try {
    const input = glb.slice(),
      item = selectionGeometry[0]
    const loaded = worker.load(input, { selectionGeometry }, [input.buffer, item.positions.buffer, item.indices.buffer])
    assert.equal(input.byteLength, 0)
    assert.equal(item.positions.byteLength, 0)
    assert.equal(item.indices.byteLength, 0)
    const renders = Array.from({ length: 16 }, () => worker.render(options))
    assert.deepEqual((await loaded).info, direct.info)
    const expected = await direct.render(options)
    for (const result of await Promise.all(renders)) assert.deepEqual(result, expected)
    assert.deepEqual(await worker.bounds({ selections: ['item'] }), direct.bounds({ selections: ['item'] }))
    const frame = await worker.prepare({ width: 32, height: 24, mirror: true })
    assert.deepEqual(await worker.project(frame, [[0, 0, 0]]), direct.project(frame, [[0, 0, 0]]))
    assert.deepEqual(await worker.edges(), direct.edges())
    await assert.rejects(worker.load(glb), /already loaded/)
    await assert.rejects(worker.replace(new Uint8Array([0])), e => e.code === 'ASSET_INVALID')
    await assert.rejects(worker.render({ ...options, width: 0 }), e => e.code === 'INVALID_OPTION' && e.path === 'width')
    assert.deepEqual(await worker.render(options), expected)
    assert.equal((await worker.replace(glb)).info.selections.length, 0)
    assert.ok(glb.byteLength)
  } finally {
    await worker.terminate()
    direct.dispose()
  }
  await assert.rejects(worker.render(options), e => e.code === 'DISPOSED')
})

test('termination rejects pending work and is idempotent; input clone failures do not poison the worker', async () => {
  const worker = new RendererWorker()
  await assert.rejects(worker.load(glb, { unsupported: () => {} }), /clone/)
  await worker.load(glb)
  const pending = worker.render({ width: 2048, height: 2048, supersample: 4 })
  const rejected = assert.rejects(pending, e => e.code === 'DISPOSED')
  await Promise.all([worker.terminate(), worker.terminate(), rejected])
})
