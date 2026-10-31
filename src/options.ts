/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */

export type Vec3 = [number, number, number]
export type NodeSelector = string | number

export interface Bounds {
  min: Vec3
  max: Vec3
}

export interface VisibilityOptions {
  only?: NodeSelector[]
  hidden?: NodeSelector[]
}

export class OptionError extends Error {
  constructor(
    readonly path: string,
    message: string,
    readonly code: 'INVALID_OPTION' | 'UNKNOWN_NODE' = 'INVALID_OPTION',
  ) {
    super(message)
    this.name = 'OptionError'
  }
}

export interface FitCamera {
  type: 'fit'
  projection?: 'perspective' | 'orthographic'
  direction?: Vec3
  up?: Vec3
  fov?: number
  margin?: number
  nodes?: NodeSelector[]
  selections?: string[]
  bounds?: Bounds
  padding?: { top?: number; right?: number; bottom?: number; left?: number }
}

export interface PerspectiveCamera {
  type: 'perspective'
  position: Vec3
  target: Vec3
  up?: Vec3
  fov?: number
  near?: number
  far?: number
}

export interface OrthographicCamera {
  type: 'orthographic'
  position: Vec3
  target: Vec3
  up?: Vec3
  height: number
  near?: number
  far?: number
}

export interface ResolvedCamera {
  type: 'resolved'
  state: {
    position: Vec3
    right: Vec3
    up: Vec3
    forward: Vec3
    projection: { type: 'perspective'; tanHalfV: number; tanHalfH: number } | { type: 'orthographic'; halfWidth: number; halfHeight: number }
    near: number
    far: number | null
    offset: [number, number]
  }
}

export interface ResolvedFrame {
  width: number
  height: number
  camera: ResolvedCamera
  mirror?: boolean
}

export interface ProjectedPoint {
  x: number | null
  y: number | null
  depth: number
  behind: boolean
  clipped: boolean
}

export interface BoundsOptions {
  nodes?: NodeSelector[]
  selections?: string[]
  visibility?: VisibilityOptions
  nodeTranslations?: { node: number; translation: Vec3 }[]
}

export type FrameOptions = Pick<RenderOptions, 'width' | 'height' | 'camera' | 'visibility' | 'nodeTranslations' | 'mirror'>
export type Camera = FitCamera | PerspectiveCamera | OrthographicCamera | ResolvedCamera | { type: 'asset'; node: number }

interface LightProperties {
  color?: Vec3
  intensity?: number
}
export type PunctualLight =
  | (LightProperties & { type: 'directional'; direction: Vec3 })
  | (LightProperties & { type: 'point'; position: Vec3; range?: number })
  | (LightProperties & { type: 'spot'; position: Vec3; direction: Vec3; range?: number; innerConeAngle?: number; outerConeAngle?: number })

export interface SelectionGeometry {
  id: string
  node?: number
  positions: number[] | Float32Array
  indices: number[] | Uint32Array
}

export interface LoadOptions {
  selectionGeometry?: SelectionGeometry[]
  scene?: number
  baseColorSpace?: 'linear' | 'srgb'
  unsupported?: 'warn' | 'error'
}

export interface Diagnostic {
  readonly code: string
  readonly path: string
  readonly message: string
}
export interface NodeInfo {
  readonly index: number
  readonly name: string | null
  readonly parent: number | null
  readonly extras: unknown
  readonly camera: number | null
  readonly light: number | null
}
export interface SceneInfo {
  readonly index: number
  readonly name: string | null
}
export interface AssetInfo {
  readonly selections: readonly { id: string; node?: number; triangles: number }[]
  readonly scenes: readonly SceneInfo[]
  readonly scene: number | null
  readonly nodes: readonly NodeInfo[]
  readonly cameras: readonly number[]
  readonly lights: readonly number[]
  readonly diagnostics: readonly Diagnostic[]
}

export type Lighting = 'classic' | 'studio'
export type ToneMapping = 'none' | 'reinhard' | 'aces'

export interface TransparencyOptions {
  maxLayers?: number
}

export interface ShadowOptions {
  resolution?: number
  strength?: number
}

export type Color = [number, number, number, number]
export interface OutlineStyle {
  color?: Color
  width?: number
  occludedAlpha?: number
  depthBias?: number
}
export interface NodeStyle {
  nodes?: NodeSelector[]
  selections?: never
  opacity?: number
  saturation?: number
  tint?: Color
  rim?: Color
  outline?: OutlineStyle
}
export interface SelectionStyle {
  selections: string[]
  nodes?: never
  opacity?: never
  saturation?: never
  rim?: never
  tint?: Color
  outline?: OutlineStyle
}
export type RenderStyle = NodeStyle | SelectionStyle
export type Annotation = {
  id: string
  node?: number
  selection?: string
  color?: Color
  depth?: 'test' | 'always'
  depthBias?: number
} & (
  | { type: 'marker'; position: Vec3; radius?: number }
  | { type: 'ring'; position: Vec3; radius: number; width?: number }
  | { type: 'line'; start: Vec3; end: Vec3; width?: number }
  | { type: 'label'; position: Vec3; offset?: [number, number]; image: { width: number; height: number; rgba: Uint8Array } }
)

export interface EdgeOptions {
  nodes?: NodeSelector[]
  angle?: number
  color?: Color
  width?: number
  depthBias?: number
}
export interface Edge {
  start: Vec3
  end: Vec3
  node: number | null
}

export interface RenderOptions {
  mirror?: boolean
  edges?: EdgeOptions
  annotations?: Annotation[]
  styles?: RenderStyle[]
  outputs?: { depth?: boolean; nodeIds?: boolean }
  width: number
  height: number
  supersample?: number
  camera?: Camera
  lights?: 'asset' | 'default' | PunctualLight[]
  light?: { direction?: Vec3; ambient?: number; hemisphere?: number }
  exposure?: number
  toneMapping?: ToneMapping
  transparency?: TransparencyOptions
  lighting?: Lighting
  shadows?: boolean | ShadowOptions
  detail?: boolean
  includeFrame?: boolean
  background?: [number, number, number, number] | 'transparent'
  highlight?: { nodes: NodeSelector[]; dim?: number }
  nodeTranslations?: { node: number; translation: Vec3 }[]
  visibility?: VisibilityOptions
}

export interface RenderResult {
  depth?: Float32Array
  nodeIds?: Uint32Array
  frame?: ResolvedFrame
  readonly diagnostics: readonly Diagnostic[]
  rgba: Uint8Array
  width: number
  height: number
}

export interface Renderer {
  readonly info: AssetInfo
  readonly triangles: number
  edges(opts?: Pick<EdgeOptions, 'nodes' | 'angle'> & Pick<BoundsOptions, 'visibility' | 'nodeTranslations'>): Edge[]
  bounds(opts?: BoundsOptions): Bounds | null
  prepare(opts: FrameOptions): ResolvedFrame
  project(frame: ResolvedFrame, points: Vec3[]): ProjectedPoint[]
  render(opts: RenderOptions): Promise<RenderResult>
  dispose(): void
}

const DEFAULT_BG: [number, number, number, number] = [0.93, 0.94, 0.95, 1]
const DEFAULT_LIGHT: Vec3 = [-30, 100, 60]
const UP: Vec3 = [0, 1, 0]
const FOV = 35

function size(name: string, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new OptionError(name, `${name} must be a positive integer`)
  return n
}

export function vec3(name: string, v: readonly number[]): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || ![0, 1, 2].every(i => typeof v[i] === 'number' && Number.isFinite(v[i])))
    throw new OptionError(name, `${name} must be three finite numbers`)
  return [v[0], v[1], v[2]]
}

function finite(name: string, n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new OptionError(name, `${name} must be a finite number`)
  return n
}

function num(name: string, value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : finite(name, value)
}

type PlacedCamera = { position: Vec3; target: Vec3; up: Vec3 }
function placed(cam: { position: Vec3; target: Vec3; up?: Vec3 }): PlacedCamera {
  const position = vec3('camera.position', cam.position)
  const target = vec3('camera.target', cam.target)
  const up = vec3('camera.up', cam.up ?? UP)
  if (Math.hypot(...up) < 1e-8) throw new OptionError('camera.up', 'camera up must be a non-zero vector')
  if (Math.hypot(...position.map((n, i) => n - target[i])) < 1e-8) throw new OptionError('camera.position', 'camera position and target are the same point')
  return { position, target, up }
}

function index(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new OptionError(name, `${name} must be a non-negative integer`)
  return value
}

function direction(name: string, value: Vec3): Vec3 {
  const result = vec3(name, value)
  const length = Math.hypot(...result)
  if (length < 1e-8) throw new OptionError(name, `${name} must be a non-zero finite vector`)
  return result.map(n => n / length) as Vec3
}

function cameraWire(cam: Camera = { type: 'fit' }) {
  if (!cam || typeof cam !== 'object') throw new OptionError('camera', 'camera must have a type: fit, perspective, orthographic or asset')
  const cameraKeys = {
    fit: ['projection', 'direction', 'up', 'fov', 'margin', 'nodes', 'selections', 'bounds', 'padding'],
    resolved: ['state'],
    perspective: ['position', 'target', 'up', 'fov', 'near', 'far'],
    orthographic: ['position', 'target', 'up', 'height', 'near', 'far'],
    asset: ['node'],
  }
  if (Object.hasOwn(cameraKeys, cam.type)) checkOptions('camera', cam, ['type', ...cameraKeys[cam.type]])
  if (cam.type === 'resolved') return { kind: 'resolved', state: resolvedState(cam.state) }
  if (cam.type === 'asset') return { kind: 'asset', node: index('camera.node', cam.node) }
  if (cam.type === 'fit' || cam.type === 'perspective') {
    const fov = num('camera.fov', cam.fov, FOV)
    if (fov < 1 || fov >= 179) throw new OptionError('camera.fov', 'camera.fov must be between 1 and 179 degrees')
    if (cam.type === 'perspective') return { kind: 'perspective', ...placed(cam), fov }
    if (cam.projection !== undefined && !['perspective', 'orthographic'].includes(cam.projection))
      throw new OptionError('camera.projection', 'camera.projection must be perspective or orthographic')
    const margin = num('camera.margin', cam.margin, 1.08)
    if (margin < 1) throw new OptionError('camera.margin', 'camera.margin must be at least 1')
    return {
      kind: 'fit',
      ortho: cam.projection === 'orthographic',
      direction: direction('camera.direction', cam.direction ?? [1, 1, 1]),
      up: direction('camera.up', cam.up ?? UP),
      margin,
      fov,
    }
  }
  if (cam.type === 'orthographic') {
    const height = finite('camera.height', cam.height)
    if (height <= 0) throw new OptionError('camera.height', 'camera.height must be positive')
    return { kind: 'ortho', ...placed(cam), height }
  }
  throw new OptionError('camera', 'camera must have a type: fit, perspective, orthographic or asset')
}

function lightsWire(lights: RenderOptions['lights']) {
  if (lights === undefined || lights === 'asset' || lights === 'default') return null
  if (!Array.isArray(lights)) throw new OptionError('lights', 'lights must be asset, default or an array')
  return Array.from(lights, (light, i) => {
    const path = `lights[${i}]`
    if (!light || !['directional', 'point', 'spot'].includes(light.type)) throw new OptionError(`${path}.type`, 'light.type must be directional, point or spot')
    const keys =
      light.type === 'directional' ? ['direction'] : light.type === 'point' ? ['position', 'range'] : ['position', 'direction', 'range', 'innerConeAngle', 'outerConeAngle']
    checkOptions(path, light, ['type', 'color', 'intensity', ...keys])
    const color = vec3(`${path}.color`, light.color ?? [1, 1, 1])
    if (color.some(n => n < 0 || n > 1)) throw new OptionError(`${path}.color`, 'light.color must be between 0 and 1')
    const intensity = num(`${path}.intensity`, light.intensity, 1)
    if (intensity < 0) throw new OptionError(`${path}.intensity`, 'light.intensity must be non-negative')
    const range = 'range' in light && light.range !== undefined ? finite(`${path}.range`, light.range) : null
    if (range !== null && (range <= 0 || light.type === 'directional')) throw new OptionError(`${path}.range`, 'light.range must be positive and only applies to point/spot lights')
    const innerConeAngle = light.type === 'spot' ? num(`${path}.innerConeAngle`, light.innerConeAngle, 0) : 0
    const outerConeAngle = light.type === 'spot' ? num(`${path}.outerConeAngle`, light.outerConeAngle, Math.PI / 4) : Math.PI / 4
    if (innerConeAngle < 0 || innerConeAngle >= outerConeAngle || outerConeAngle > Math.PI / 2)
      throw new OptionError(path, 'spot angles must satisfy 0 <= innerConeAngle < outerConeAngle <= PI/2')
    return {
      type: light.type,
      color,
      intensity,
      range,
      innerConeAngle,
      outerConeAngle,
      position: light.type === 'directional' ? [0, 0, 0] : vec3(`${path}.position`, light.position),
      direction: light.type === 'point' ? [0, 0, -1] : direction(`${path}.direction`, light.direction),
    }
  })
}

export function selectors(path: string, value: NodeSelector[]): NodeSelector[] {
  if (!Array.isArray(value) || !Array.from(value).every(n => typeof n === 'string' || (Number.isSafeInteger(n) && Number(n) >= 0)))
    throw new OptionError(path, `${path} must contain names or non-negative node indices`)
  return [...value]
}

function boundsWire(bounds: Bounds): Bounds {
  checkOptions('camera.bounds', bounds, ['min', 'max'])
  const min = vec3('camera.bounds.min', bounds.min)
  const max = vec3('camera.bounds.max', bounds.max)
  if (min.some((v, i) => v > max[i])) throw new OptionError('camera.bounds', 'camera.bounds needs min <= max on every axis')
  return { min, max }
}

export function checkOptions(name: string, value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OptionError(name, `${name} options must be an object`)
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new OptionError(name === 'render' || name === 'load' ? key : `${name}.${key}`, `unknown ${name} option: ${key}`)
}

export function loadWire(options: LoadOptions = {}) {
  checkOptions('load', options, ['scene', 'baseColorSpace', 'unsupported', 'selectionGeometry'] satisfies (keyof LoadOptions)[])
  const scene = options.scene === undefined ? undefined : index('scene', options.scene)
  const baseColorSpace = options.baseColorSpace ?? 'linear'
  const unsupported = options.unsupported ?? 'warn'
  if (!['linear', 'srgb'].includes(baseColorSpace)) throw new OptionError('baseColorSpace', 'baseColorSpace must be linear or srgb')
  if (!['warn', 'error'].includes(unsupported)) throw new OptionError('unsupported', 'unsupported must be warn or error')
  return { scene, baseColorSpace, unsupported }
}

function shadowsWire(shadows: RenderOptions['shadows']) {
  if (shadows === undefined || shadows === false) return null
  if (shadows !== true && (!shadows || typeof shadows !== 'object' || Array.isArray(shadows))) throw new OptionError('shadows', 'shadows must be a boolean or shadow options')
  const options = shadows === true ? {} : shadows
  checkOptions('shadows', options, ['resolution', 'strength'])
  const resolution = size('shadows.resolution', options.resolution ?? 1024)
  if (resolution < 256 || resolution > 2048) throw new OptionError('shadows.resolution', 'shadows.resolution must be between 256 and 2048')
  const strength = num('shadows.strength', options.strength, 1)
  if (strength < 0 || strength > 1) throw new OptionError('shadows.strength', 'shadows.strength must be between 0 and 1')
  return { resolution, strength }
}

function transparencyWire(options: RenderOptions['transparency']) {
  if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) throw new OptionError('transparency', 'transparency must be an options object')
  if (options !== undefined) checkOptions('transparency', options, ['maxLayers'])
  const maxLayers = size('transparency.maxLayers', options?.maxLayers ?? 32)
  if (maxLayers > 128) throw new OptionError('transparency.maxLayers', 'transparency.maxLayers must be between 1 and 128')
  return { maxLayers }
}

export function wire(opts: RenderOptions) {
  checkOptions('render', opts, [
    'width',
    'height',
    'supersample',
    'camera',
    'lights',
    'light',
    'exposure',
    'toneMapping',
    'transparency',
    'lighting',
    'shadows',
    'detail',
    'includeFrame',
    'mirror',
    'outputs',
    'edges',
    'annotations',
    'styles',
    'background',
    'highlight',
    'nodeTranslations',
    'visibility',
  ] satisfies (keyof RenderOptions)[])
  const width = size('width', opts.width)
  const height = size('height', opts.height)
  if (width > 4096 || height > 4096) throw new OptionError(width > 4096 ? 'width' : 'height', `image is ${width} by ${height} before supersampling; the limit is 4096 by 4096`)
  const supersample = opts.supersample === undefined ? 2 : size('supersample', opts.supersample)
  if (supersample > 8) throw new OptionError('supersample', `supersample ${supersample} is outside 1 to 8`)
  if (width * supersample > 8192 || height * supersample > 8192)
    throw new OptionError('supersample', `supersampled image is ${width * supersample} by ${height * supersample}; the limit is 8192 along an edge`)
  const background = opts.background === 'transparent' ? [0, 0, 0, 0] : opts.background === undefined ? DEFAULT_BG : opts.background
  if (!Array.isArray(background) || background.length !== 4 || ![0, 1, 2, 3].every(i => typeof background[i] === 'number' && Number.isFinite(background[i])))
    throw new OptionError('background', 'background must be four finite numbers or "transparent"')
  const camera = cameraWire(opts.camera)
  if (opts.highlight !== undefined) checkOptions('highlight', opts.highlight, ['nodes', 'dim'])
  const highlight = opts.highlight === undefined ? [] : selectors('highlight.nodes', opts.highlight.nodes)
  if (opts.light !== undefined) checkOptions('light', opts.light, ['direction', 'ambient', 'hemisphere'])
  if (opts.visibility !== undefined) checkOptions('visibility', opts.visibility, ['only', 'hidden'])
  const visibility = {
    ...(opts.visibility?.only === undefined ? {} : { only: selectors('visibility.only', opts.visibility.only) }),
    hidden: opts.visibility?.hidden === undefined ? [] : selectors('visibility.hidden', opts.visibility.hidden),
  }
  const fit = opts.camera?.type === 'fit' ? opts.camera : undefined
  if ([fit?.nodes, fit?.bounds, fit?.selections].filter(v => v !== undefined).length > 1)
    throw new OptionError('camera', 'camera.nodes, camera.selections and camera.bounds are mutually exclusive')
  const fitNodes = fit?.nodes === undefined ? undefined : selectors('camera.nodes', fit.nodes)
  if (fitNodes?.length === 0) throw new OptionError('camera.nodes', 'camera.nodes must select visible geometry')
  const padding = paddingWire(fit?.padding, width, height)
  if (opts.mirror) [padding[1], padding[3]] = [padding[3], padding[1]]
  const fitBounds = fit?.bounds === undefined ? undefined : boundsWire(fit.bounds)
  if (opts.includeFrame !== undefined && typeof opts.includeFrame !== 'boolean') throw new OptionError('includeFrame', 'includeFrame must be a boolean')
  if (opts.mirror !== undefined && typeof opts.mirror !== 'boolean') throw new OptionError('mirror', 'mirror must be a boolean')
  if (opts.detail !== undefined && typeof opts.detail !== 'boolean') throw new OptionError('detail', 'detail must be a boolean')
  const lightDir = vec3('light.direction', opts.light?.direction ?? DEFAULT_LIGHT)
  if (Math.hypot(...lightDir) < 1e-8) throw new OptionError('light.direction', 'light direction must be a non-zero finite vector')
  const lighting = opts.lighting ?? 'classic'
  if (lighting !== 'classic' && lighting !== 'studio') throw new OptionError('lighting', 'lighting must be classic or studio')
  const exposure = num('exposure', opts.exposure, 0)
  if (exposure < -20 || exposure > 20) throw new OptionError('exposure', 'exposure must be between -20 and 20 stops')
  const toneMapping = opts.toneMapping ?? 'none'
  if (!['none', 'reinhard', 'aces'].includes(toneMapping)) throw new OptionError('toneMapping', 'toneMapping must be none, reinhard or aces')
  if (opts.nodeTranslations !== undefined && !Array.isArray(opts.nodeTranslations)) throw new OptionError('nodeTranslations', 'nodeTranslations must be an array')
  const clip = opts.camera?.type === 'perspective' || opts.camera?.type === 'orthographic' ? opts.camera : undefined
  const near = clip?.near === undefined ? null : finite('camera.near', clip.near)
  const far = clip?.far === undefined ? null : finite('camera.far', clip.far)
  if ((near !== null && (near < 0 || (clip?.type === 'perspective' && near === 0))) || (far !== null && far <= (near ?? 0)))
    throw new OptionError('camera', 'camera clipping planes need near < far and a positive perspective near')
  if (opts.outputs !== undefined) checkOptions('outputs', opts.outputs, ['depth', 'nodeIds'])
  for (const key of ['depth', 'nodeIds'] as const)
    if (opts.outputs?.[key] !== undefined && typeof opts.outputs[key] !== 'boolean') throw new OptionError(`outputs.${key}`, 'output flags must be boolean')
  if (opts.edges !== undefined) edgeOptions(opts.edges)
  annotationsWire(opts.annotations)
  const styles = stylesWire(opts.styles)
  return {
    styles,
    outputs: { depth: opts.outputs?.depth === true, nodeIds: opts.outputs?.nodeIds === true },
    visibility,
    fitNodes,
    fitBounds,
    padding,
    lights: lightsWire(opts.lights),
    useAssetLights: opts.lights !== 'default',
    near,
    far,
    exposure,
    toneMapping,
    transparency: transparencyWire(opts.transparency),
    lighting,
    shadows: shadowsWire(opts.shadows),
    width,
    height,
    supersample,
    background,
    lightDir,
    ambient: num('light.ambient', opts.light?.ambient, 0.25),
    hemisphere: num('light.hemisphere', opts.light?.hemisphere, 0),
    nodeTranslations: Array.from(opts.nodeTranslations ?? [], (t, i) => {
      const path = `nodeTranslations[${i}]`
      checkOptions(path, t, ['node', 'translation'])
      return { node: index(`${path}.node`, t.node), translation: vec3(`${path}.translation`, t.translation) }
    }),
    detail: opts.detail === true,
    highlight: highlight.filter(n => typeof n === 'string'),
    highlightIndices: highlight.filter(n => typeof n === 'number'),
    dim: num('highlight.dim', opts.highlight?.dim, 0.25),
    camera,
  }
}

function paddingWire(padding: FitCamera['padding'], width: number, height: number) {
  if (padding !== undefined) checkOptions('camera.padding', padding, ['top', 'right', 'bottom', 'left'])
  const edges = (['top', 'right', 'bottom', 'left'] as const).map(edge => {
    const value = num(`camera.padding.${edge}`, padding?.[edge], 0)
    if (value < 0) throw new OptionError(`camera.padding.${edge}`, 'padding must be non-negative')
    return value
  })
  if (edges[1] + edges[3] >= width || edges[0] + edges[2] >= height) throw new OptionError('camera.padding', 'padding must leave a positive viewport')
  return edges
}

function resolvedState(state: ResolvedCamera['state']): ResolvedCamera['state'] {
  const path = 'camera.state'
  checkOptions(path, state, ['position', 'right', 'up', 'forward', 'projection', 'near', 'far', 'offset'])
  const position = vec3(`${path}.position`, state.position)
  const right = vec3(`${path}.right`, state.right)
  const up = vec3(`${path}.up`, state.up)
  const forward = vec3(`${path}.forward`, state.forward)
  const dot = (a: Vec3, b: Vec3) => a.reduce((sum, v, i) => sum + v * b[i], 0)
  const cross: Vec3 = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]]
  if (
    [right, up, forward].some(v => Math.abs(dot(v, v) - 1) > 1e-4) ||
    Math.abs(dot(right, up)) > 1e-4 ||
    Math.abs(dot(right, forward)) > 1e-4 ||
    Math.abs(dot(up, forward)) > 1e-4 ||
    dot(cross, forward) > -0.9999
  )
    throw new OptionError(path, 'resolved camera basis must be orthonormal and right-handed')
  const p = state.projection
  if (!p || !['perspective', 'orthographic'].includes(p.type)) throw new OptionError(`${path}.projection`, 'invalid resolved projection')
  checkOptions(`${path}.projection`, p, p.type === 'perspective' ? ['type', 'tanHalfV', 'tanHalfH'] : ['type', 'halfWidth', 'halfHeight'])
  for (const [key, value] of Object.entries(p))
    if (key !== 'type' && finite(`${path}.projection.${key}`, value as number) <= 0) throw new OptionError(`${path}.projection.${key}`, 'projection extents must be positive')
  const extents = p.type === 'perspective' ? [p.tanHalfV, p.tanHalfH] : [p.halfWidth, p.halfHeight]
  if (extents.some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) throw new OptionError(`${path}.projection`, 'projection extents must be positive and finite')
  const near = finite(`${path}.near`, state.near)
  const far = state.far === null ? null : finite(`${path}.far`, state.far)
  if (near < 0 || (p.type === 'perspective' && near === 0) || (far !== null && far <= near)) throw new OptionError(path, 'invalid resolved clipping planes')
  if (!Array.isArray(state.offset) || state.offset.length !== 2 || ![0, 1].every(i => typeof state.offset[i] === 'number' && Number.isFinite(state.offset[i])))
    throw new OptionError(`${path}.offset`, 'offset must be two finite numbers')
  return { position, right, up, forward, projection: { ...p }, near, far, offset: [...state.offset] }
}

function unit(path: string, value: number | undefined, fallback: number): number {
  const n = num(path, value, fallback)
  if (n < 0 || n > 1) throw new OptionError(path, 'value must be between zero and one')
  return n
}
function color(path: string, value: Color | undefined, fallback: Color): Color {
  if (value === undefined) return fallback
  if (!Array.isArray(value) || value.length !== 4 || ![0, 1, 2, 3].every(i => typeof value[i] === 'number' && Number.isFinite(value[i]) && value[i] >= 0 && value[i] <= 1))
    throw new OptionError(path, 'color must be four numbers between zero and one')
  return [...value]
}
function pixels(path: string, value: number | undefined, fallback: number, max = 256): number {
  const n = num(path, value, fallback)
  if (n <= 0 || n > max) throw new OptionError(path, `size must be greater than zero and at most ${max} pixels`)
  return n
}
function bias(path: string, value: number | undefined): number {
  const n = num(path, value, 0)
  if (n < 0 || n > 1000) throw new OptionError(path, 'depth bias must be between zero and 1000 metres')
  return n
}
function stylesWire(styles: RenderStyle[] = []) {
  if (!Array.isArray(styles) || styles.length > 32) throw new OptionError('styles', 'styles must be an array of at most 32 groups')
  return Array.from(styles, (style, i) => {
    const path = `styles[${i}]`
    checkOptions(path, style, ['nodes', 'selections', 'opacity', 'saturation', 'tint', 'rim', 'outline'])
    if (style.selections !== undefined && [style.nodes, style.opacity, style.saturation, style.rim].some(v => v !== undefined))
      throw new OptionError(path, 'selection styles accept tint and outline only')
    if (style.outline !== undefined) {
      checkOptions(`${path}.outline`, style.outline, ['color', 'width', 'occludedAlpha', 'depthBias'])
      color(`${path}.outline.color`, style.outline.color, [1, 1, 1, 1])
      pixels(`${path}.outline.width`, style.outline.width, 1.5, 32)
      unit(`${path}.outline.occludedAlpha`, style.outline.occludedAlpha, 0)
      bias(`${path}.outline.depthBias`, style.outline.depthBias)
    }
    return {
      nodes: style.selections !== undefined ? [] : style.nodes === undefined ? null : selectors(`${path}.nodes`, style.nodes),
      surface: {
        opacity: unit(`${path}.opacity`, style.opacity, 1),
        saturation: unit(`${path}.saturation`, style.saturation, 1),
        tint: color(`${path}.tint`, style.tint, [0, 0, 0, 0]),
        rim: color(`${path}.rim`, style.rim, [0, 0, 0, 0]),
      },
    }
  })
}
function annotationsWire(annotations: Annotation[] = []) {
  if (!Array.isArray(annotations) || annotations.length > 4096) throw new OptionError('annotations', 'annotations must be an array of at most 4096 primitives')
  const ids = new Set<string>()
  let labelBytes = 0
  Array.from(annotations, (a, i) => {
    const path = `annotations[${i}]`
    if (!a || !['marker', 'ring', 'line', 'label'].includes(a.type)) throw new OptionError(path, 'unknown annotation type')
    const keys =
      a.type === 'line'
        ? ['start', 'end', 'width']
        : a.type === 'label'
          ? ['position', 'offset', 'image']
          : a.type === 'ring'
            ? ['position', 'radius', 'width']
            : ['position', 'radius']
    checkOptions(path, a, ['type', 'id', 'node', 'selection', 'color', 'depth', 'depthBias', ...keys])
    if (typeof a.id !== 'string' || !a.id || ids.has(a.id)) throw new OptionError(`${path}.id`, 'annotation IDs must be nonempty and unique')
    ids.add(a.id)
    if (a.selection !== undefined && (typeof a.selection !== 'string' || !a.selection || a.node !== undefined))
      throw new OptionError(`${path}.selection`, 'selection must be a nonempty ID and cannot be combined with node')
    if (a.node !== undefined) index(`${path}.node`, a.node)
    color(`${path}.color`, a.color, [1, 0.5, 0, 1])
    if (a.depth !== undefined && a.depth !== 'test' && a.depth !== 'always') throw new OptionError(`${path}.depth`, 'depth must be test or always')
    bias(`${path}.depthBias`, a.depthBias)
    if (a.type === 'line') {
      vec3(`${path}.start`, a.start)
      vec3(`${path}.end`, a.end)
      pixels(`${path}.width`, a.width, 1.5, 32)
    } else {
      vec3(`${path}.position`, a.position)
      if (a.type === 'label') {
        checkOptions(`${path}.image`, a.image, ['width', 'height', 'rgba'])
        const w = size(`${path}.image.width`, a.image.width),
          h = size(`${path}.image.height`, a.image.height)
        if (w > 2048 || h > 2048 || !(a.image.rgba instanceof Uint8Array) || a.image.rgba.length !== w * h * 4)
          throw new OptionError(`${path}.image`, 'label image must be RGBA with edges at most 2048 pixels')
        labelBytes += a.image.rgba.length
        if (labelBytes > 16 * 1024 * 1024) throw new OptionError('annotations', 'label images exceed 16 MiB')
        if (a.offset !== undefined && (!Array.isArray(a.offset) || a.offset.length !== 2 || ![0, 1].every(i => Number.isFinite(a.offset![i]))))
          throw new OptionError(`${path}.offset`, 'offset must be two finite numbers')
      } else {
        if (a.type === 'ring' && a.radius === undefined) throw new OptionError(`${path}.radius`, 'ring radius is required')
        pixels(`${path}.radius`, a.radius, 4)
        if (a.type === 'ring') pixels(`${path}.width`, a.width, 1.5, 32)
      }
    }
  })
}

export function edgeOptions(opts: EdgeOptions) {
  checkOptions('edges', opts, ['nodes', 'angle', 'color', 'width', 'depthBias'])
  if (opts.nodes !== undefined) selectors('edges.nodes', opts.nodes)
  const angle = num('edges.angle', opts.angle, 30)
  if (angle < 0 || angle > 180) throw new OptionError('edges.angle', 'angle must be between zero and 180 degrees')
  color('edges.color', opts.color, [0, 0, 0, 1])
  pixels('edges.width', opts.width, 1, 32)
  bias('edges.depthBias', opts.depthBias)
  return angle
}
