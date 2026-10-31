/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { protectRenderer, RendererError } from './errors.js'
import { selectionGeometry, selectionNodes } from './selections.js'
import { annotate, outline, fill } from './inspection.js'
import { mirrorPixels, mirrorPoints } from './mirror.js'
import type { Scene } from '../build/pkg/renderer.js'
import {
  wire,
  edgeOptions,
  checkOptions,
  selectors,
  vec3,
  OptionError,
  type AssetInfo,
  type NodeSelector,
  type Renderer,
  type RenderOptions,
  type SelectionGeometry,
} from './options.js'

export function createSceneRenderer(loaded: Scene, geometry?: SelectionGeometry[]): Renderer {
  let scene: Scene | undefined = loaded
  const info: AssetInfo = JSON.parse(scene.info())
  let selectionScene: Scene | undefined
  let items: SelectionGeometry[]
  try {
    items = selectionGeometry(geometry, info)
    if (items.length) {
      selectionScene = loaded.selection_geometry()
      for (const item of items)
        selectionScene.add_selection(
          item.id,
          item.node,
          item.positions instanceof Float32Array ? item.positions : new Float32Array(item.positions),
          item.indices instanceof Uint32Array ? item.indices : new Uint32Array(item.indices),
        )
    }
  } catch (error) {
    selectionScene?.free()
    loaded.free()
    throw error
  }
  const first = info.nodes.reduce((max, n) => Math.max(max, n.index), -1) + 1
  const selectionIds = new Map(items.map((item, i) => [item.id, first + i]))
  Object.assign(info, { selections: items.map(item => ({ id: item.id, ...(item.node === undefined ? {} : { node: item.node }), triangles: item.indices.length / 3 })) })
  const selected = (path: string, ids: string[]) => selectionNodes(path, ids, selectionIds)
  const indices = new Set(info.nodes.map(node => node.index))
  const names = new Set(info.nodes.flatMap(node => (node.name === null ? [] : [node.name])))
  const checkNode = (path: string, node: NodeSelector) => {
    if (typeof node === 'number' ? !indices.has(node) : !names.has(node))
      throw new OptionError(path, `${path} references a node outside the selected scene: ${JSON.stringify(node)}`, 'UNKNOWN_NODE')
  }
  const checkNodes = (path: string, nodes: NodeSelector[] = []) => nodes.forEach((node, i) => checkNode(`${path}[${i}]`, node))
  const active = () => {
    if (!scene) throw new RendererError('DISPOSED', 'access', 'renderer has been disposed', false)
    return scene
  }
  const validate = (opts: RenderOptions) => {
    active()
    const body = wire(opts)
    opts.styles?.forEach((style, i) => {
      if (style.selections !== undefined) selected(`styles[${i}].selections`, style.selections)
    })
    checkNodes('highlight.nodes', opts.highlight?.nodes)
    checkNodes('visibility.only', body.visibility.only)
    checkNodes('visibility.hidden', body.visibility.hidden)
    checkNodes('camera.nodes', body.fitNodes)
    body.styles.forEach((style, i) => checkNodes(`styles[${i}].nodes`, style.nodes ?? []))
    opts.annotations?.forEach((annotation, i) => {
      if (annotation.node !== undefined) checkNode(`annotations[${i}].node`, annotation.node)
      if (annotation.selection !== undefined) selected(`annotations[${i}].selection`, [annotation.selection])
    })
    body.nodeTranslations.forEach((offset, i) => checkNode(`nodeTranslations[${i}].node`, offset.node))
    if (opts.camera?.type === 'fit' && opts.camera.selections !== undefined) {
      const nodes = selected('camera.selections', opts.camera.selections)
      const bounds = selectionScene ? JSON.parse(selectionScene.bounds(JSON.stringify({ ...body, styles: [] }), JSON.stringify(nodes))) : null
      if (!bounds) throw new OptionError('camera.selections', 'camera.selections must select visible geometry')
      body.fitBounds = bounds
    }
    return body
  }
  return protectRenderer(
    {
      get info() {
        active()
        return structuredClone(info)
      },
      get triangles() {
        return active().triangles
      },
      edges(opts = {}) {
        active()
        checkOptions('edges', opts, ['nodes', 'angle', 'visibility', 'nodeTranslations'])
        const { visibility, nodeTranslations, ...edge } = opts
        const angle = edgeOptions(edge)
        checkNodes('edges.nodes', edge.nodes)
        const body = validate({ width: 1, height: 1, visibility, nodeTranslations })
        return JSON.parse(active().edges(JSON.stringify(body), angle, JSON.stringify(edge.nodes ?? null)))
      },
      bounds(opts = {}) {
        active()
        checkOptions('bounds', opts, ['nodes', 'selections', 'visibility', 'nodeTranslations'])
        if (opts.nodes !== undefined && opts.selections !== undefined) throw new OptionError('bounds', 'nodes and selections are mutually exclusive')
        const nodes = opts.nodes === undefined ? null : selectors('nodes', opts.nodes)
        checkNodes('nodes', nodes ?? [])
        const body = validate({ width: 1, height: 1, visibility: opts.visibility, nodeTranslations: opts.nodeTranslations })
        if (opts.selections !== undefined) {
          const nodes = selected('selections', opts.selections)
          return selectionScene ? JSON.parse(selectionScene.bounds(JSON.stringify(body), JSON.stringify(nodes))) : null
        }
        return JSON.parse(active().bounds(JSON.stringify(body), JSON.stringify(nodes)))
      },
      prepare(opts) {
        active()
        checkOptions('prepare', opts, ['width', 'height', 'camera', 'visibility', 'nodeTranslations', 'mirror'])
        return { ...JSON.parse(active().prepare(JSON.stringify(validate({ ...opts, supersample: 1 })))), ...(opts.mirror ? { mirror: true } : {}) }
      },
      project(frame, points) {
        active()
        checkOptions('frame', frame, ['width', 'height', 'camera', 'mirror'])
        if (frame.camera?.type !== 'resolved') throw new OptionError('frame.camera', 'projection requires a resolved frame')
        if (!Array.isArray(points)) throw new OptionError('points', 'points must be an array')
        const checked = Array.from(points, (point, i) => vec3(`points[${i}]`, point))
        const body = validate({ ...frame, supersample: 1 })
        return mirrorPoints(JSON.parse(active().project(JSON.stringify(body), JSON.stringify(checked))), frame)
      },
      async render(opts: RenderOptions) {
        const checked = validate(opts)
        const overlays = !!opts.edges || !!opts.annotations?.length || !!opts.styles?.some(style => style.outline || style.selections !== undefined)
        if (overlays) checked.outputs.depth = true
        const body = JSON.stringify(checked)
        const frame = opts.includeFrame || overlays ? JSON.parse(active().prepare(body)) : undefined
        if (frame && opts.mirror) frame.mirror = true
        const image = checked.outputs.depth || checked.outputs.nodeIds ? active().render_outputs(body) : undefined
        let rgba: Uint8Array
        let depth: Float32Array | undefined
        let nodeIds: Uint32Array | undefined
        try {
          rgba = image ? image.take_rgba() : active().render(body)
          if (checked.outputs.depth) depth = image!.take_depth()
          if (opts.outputs?.nodeIds) nodeIds = image!.take_node_ids()
        } finally {
          image?.free()
        }
        if (opts.mirror) {
          mirrorPixels(rgba, opts.width, opts.height, 4)
          if (depth) mirrorPixels(depth, opts.width, opts.height)
          if (nodeIds) mirrorPixels(nodeIds, opts.width, opts.height)
        }
        if (overlays) {
          const maskOptions = JSON.stringify({
            ...checked,
            camera: { kind: 'resolved', state: frame.camera.state },
            fitNodes: undefined,
            fitBounds: undefined,
            padding: [0, 0, 0, 0],
          })
          const proxyOptions = JSON.stringify({
            ...JSON.parse(maskOptions),
            styles: checked.styles.map((style, i) => ({
              ...style,
              nodes: opts.styles![i].selections === undefined ? [] : selected(`styles[${i}].selections`, opts.styles![i].selections!),
            })),
          })
          for (const [i, style] of (opts.styles ?? []).entries())
            if (style.outline || style.selections !== undefined) {
              const target = style.selections === undefined ? active() : selectionScene
              if (!target) continue
              const mask = target.render_style_mask(style.selections === undefined ? maskOptions : proxyOptions, i)
              try {
                const pixels = mask.take_depth()
                if (opts.mirror) mirrorPixels(pixels, opts.width, opts.height)
                if (style.selections !== undefined && style.tint) fill(rgba, depth!, pixels, style.tint, style.outline)
                if (style.outline) outline(rgba, depth!, pixels, opts.width, opts.height, style.outline)
              } finally {
                mask.free()
              }
            }
          if (opts.edges) {
            const segments = this.edges({ nodes: opts.edges.nodes, angle: opts.edges.angle, visibility: opts.visibility, nodeTranslations: opts.nodeTranslations })
            annotate(
              rgba,
              depth!,
              frame,
              {
                ...opts,
                annotations: segments.map((e, i) => ({
                  id: `edge${i}`,
                  type: 'line',
                  start: e.start,
                  end: e.end,
                  color: opts.edges!.color ?? [0, 0, 0, 1],
                  width: opts.edges!.width ?? 1,
                  depthBias: opts.edges!.depthBias,
                })),
              },
              info,
              points => mirrorPoints(JSON.parse(active().project(maskOptions, JSON.stringify(points))), frame),
            )
          }
          annotate(rgba, depth!, frame, opts, info, points => mirrorPoints(JSON.parse(active().project(maskOptions, JSON.stringify(points))), frame))
        }
        return {
          rgba,
          ...(opts.outputs?.depth ? { depth } : {}),
          ...(nodeIds ? { nodeIds } : {}),
          width: opts.width,
          height: opts.height,
          diagnostics: structuredClone(info.diagnostics),
          ...(opts.includeFrame ? { frame } : {}),
        }
      },
      dispose() {
        selectionScene?.free()
        selectionScene = undefined
        scene?.free()
        scene = undefined
      },
    },
    () => {
      scene = undefined
      selectionScene = undefined
    },
  )
}
