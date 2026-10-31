/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { readFile } from 'node:fs/promises'
import { createRenderer, encodePng } from '../dist/index.mjs'
import { InspectionWorker } from '../examples/worker-client.mjs'

for (const name of ['blinky', 'psu']) {
  const glb = await readFile(new URL(`../docs/public/models/${name}.glb`, import.meta.url))
  const rss = process.memoryUsage().rss,
    start = performance.now()
  const renderer = await createRenderer(glb)
  const loaded = performance.now()
  const node = renderer.info.nodes.find(n => renderer.bounds({ nodes: [n.index] }))?.index
  const bounds = renderer.bounds({ nodes: [node] })
  const position = bounds.min.map((v, i) => (v + bounds.max[i]) / 2)
  const opts = { width: 800, height: 600, supersample: 2, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] } }
  const image = await renderer.render(opts)
  const rendered = performance.now()
  await encodePng(image.rgba, image.width, image.height)
  const png = performance.now()
  const requests = [
    { ...opts, camera: { type: 'fit', direction: [0, 1, 0], up: [0, 0, -1] } },
    { ...opts, camera: { type: 'fit', direction: [0, -1, 0], up: [0, 0, 1] } },
    {
      ...opts,
      styles: [{ nodes: [node], saturation: 0.2, outline: { color: [1, 0.7, 0, 1] } }],
      annotations: [{ id: 'finding', type: 'ring', position, radius: 8, depth: 'always' }],
    },
  ]
  const warm = []
  for (const request of requests) {
    const t = performance.now()
    const frame = await renderer.render(request)
    await encodePng(frame.rgba, frame.width, frame.height)
    warm.push(performance.now() - t)
  }
  const [x0, y0, z0] = bounds.min,
    [x1, , z1] = bounds.max
  const proxy = { id: 'bounds-proxy', node, positions: [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], indices: [0, 1, 2, 0, 2, 3] }
  const proxyStart = performance.now()
  const selected = await createRenderer(glb, { selectionGeometry: [proxy] })
  const proxyLoaded = performance.now()
  await selected.render({ ...opts, styles: [{ selections: [proxy.id], tint: [1, 0.7, 0, 0.1], outline: { color: [1, 0.7, 0, 1], occludedAlpha: 0.2 } }] })
  const proxyRendered = performance.now()
  selected.dispose()
  const worker = new InspectionWorker()
  const workerStart = performance.now()
  await worker.replace(glb)
  const workerLoaded = performance.now()
  await worker.request('render', requests[2])
  const workerEnd = performance.now()
  const triangles = renderer.triangles
  renderer.dispose()
  await worker.dispose()
  const ms = value => Math.round(value * 10) / 10
  console.log(
    JSON.stringify({
      model: name,
      node: process.version,
      triangles,
      glbBytes: glb.length,
      loadMs: ms(loaded - start),
      selectionFixtureBytes: 72,
      selectionFixtureLoadMs: ms(proxyLoaded - proxyStart),
      selectionFixtureRenderMs: ms(proxyRendered - proxyLoaded),
      renderMs: ms(rendered - loaded),
      pngMs: ms(png - rendered),
      repeatedRenderPngMs: warm.map(ms),
      workerStartupLoadMs: ms(workerLoaded - workerStart),
      workerRenderTransferMs: ms(workerEnd - workerLoaded),
      rssGrowthMiB: ms((process.memoryUsage().rss - rss) / 1048576),
      renderBudgetMs: 2000,
      inspectionBudgetMs: 3000,
      budgetMet: rendered - loaded < 2000 && warm.every(n => n < 3000),
    }),
  )
}
