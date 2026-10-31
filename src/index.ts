/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { failure } from './errors.js'
export { RendererError, serializeError } from './errors.js'
export type { ErrorRecord, ErrorCode } from './errors.js'
import { loadWasm, Scene } from './load.js'
import { loadWire, type LoadOptions, type RenderOptions, type Renderer, type RenderResult } from './options.js'
import { encodePng } from './png.js'
import { createSceneRenderer } from './renderer.js'

export { encodePng }
export { OptionError } from './options.js'
export type {
  Edge,
  EdgeOptions,
  SelectionGeometry,
  Bounds,
  Annotation,
  Color,
  NodeStyle,
  SelectionStyle,
  RenderStyle,
  OutlineStyle,
  BoundsOptions,
  FrameOptions,
  ResolvedCamera,
  ResolvedFrame,
  ProjectedPoint,
  VisibilityOptions,
  AssetInfo,
  Camera,
  Diagnostic,
  FitCamera,
  LoadOptions,
  NodeInfo,
  NodeSelector,
  PunctualLight,
  SceneInfo,
  ToneMapping,
  TransparencyOptions,
  Lighting,
  ShadowOptions,
  OrthographicCamera,
  PerspectiveCamera,
  RenderOptions,
  RenderResult,
  Renderer,
  Vec3,
} from './options.js'

function glbBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  throw failure(new Error('GLB must be a Uint8Array or an ArrayBuffer'), 'ASSET_INVALID', 'load')
}

export async function createRenderer(glb: Uint8Array | ArrayBuffer, options?: LoadOptions): Promise<Renderer> {
  const bytes = glbBytes(glb)
  const loadOptions = loadWire(options)
  try {
    await loadWasm()
  } catch (error) {
    throw failure(error, 'INITIALIZATION_FAILED', 'load')
  }
  try {
    return createSceneRenderer(new Scene(bytes, JSON.stringify(loadOptions)), options?.selectionGeometry)
  } catch (error) {
    throw failure(error, 'ASSET_INVALID', 'load')
  }
}

export async function render(glb: Uint8Array | ArrayBuffer, opts: RenderOptions, loadOptions?: LoadOptions): Promise<RenderResult> {
  const renderer = await createRenderer(glb, loadOptions)
  try {
    return await renderer.render(opts)
  } finally {
    renderer.dispose()
  }
}
