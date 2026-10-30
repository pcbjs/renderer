/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */

export type Vec3 = [number, number, number]
export type NodeSelector = string | number

export interface FitCamera {
  type: 'fit'
  projection?: 'perspective' | 'orthographic'
  direction?: Vec3
  up?: Vec3
  fov?: number
  margin?: number
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

export type Camera = FitCamera | PerspectiveCamera | OrthographicCamera | { type: 'asset'; node: number }

interface LightProperties {
  color?: Vec3
  intensity?: number
}
export type PunctualLight =
  | (LightProperties & { type: 'directional'; direction: Vec3 })
  | (LightProperties & { type: 'point'; position: Vec3; range?: number })
  | (LightProperties & { type: 'spot'; position: Vec3; direction: Vec3; range?: number; innerConeAngle?: number; outerConeAngle?: number })

export interface LoadOptions {
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

export interface RenderOptions {
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
  background?: [number, number, number, number] | 'transparent'
  highlight?: { nodes: NodeSelector[]; dim?: number }
  nodeTranslations?: { node: number; translation: Vec3 }[]
}

export interface RenderResult {
  readonly diagnostics: readonly Diagnostic[]
  rgba: Uint8Array
  width: number
  height: number
}

export interface Renderer {
  readonly info: AssetInfo
  readonly triangles: number
  render(opts: RenderOptions): Promise<RenderResult>
  dispose(): void
}

const DEFAULT_BG: [number, number, number, number] = [0.93, 0.94, 0.95, 1]
const DEFAULT_LIGHT: Vec3 = [-30, 100, 60]
const UP: Vec3 = [0, 1, 0]
const FOV = 35

function size(name: string, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`)
  return n
}

function vec3(name: string, v: readonly number[]): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || ![0, 1, 2].every(i => typeof v[i] === 'number' && Number.isFinite(v[i]))) throw new Error(`${name} must be three finite numbers`)
  return [v[0], v[1], v[2]]
}

function finite(name: string, n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${name} must be a finite number`)
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
  if (Math.hypot(...up) < 1e-8) throw new Error('camera up must be a non-zero vector')
  if (Math.hypot(...position.map((n, i) => n - target[i])) < 1e-8) throw new Error('camera position and target are the same point')
  return { position, target, up }
}

function index(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

function direction(name: string, value: Vec3): Vec3 {
  const result = vec3(name, value)
  const length = Math.hypot(...result)
  if (length < 1e-8) throw new Error(`${name} must be a non-zero finite vector`)
  return result.map(n => n / length) as Vec3
}

function cameraWire(cam: Camera = { type: 'fit' }) {
  if (!cam || typeof cam !== 'object') throw new Error('camera must have a type: fit, perspective, orthographic or asset')
  if (cam.type === 'asset') return { kind: 'asset', node: index('camera.node', cam.node) }
  if (cam.type === 'fit' || cam.type === 'perspective') {
    const fov = num('camera.fov', cam.fov, FOV)
    if (fov < 1 || fov >= 179) throw new Error('camera.fov must be between 1 and 179 degrees')
    if (cam.type === 'perspective') return { kind: 'perspective', ...placed(cam), fov }
    if (cam.projection !== undefined && !['perspective', 'orthographic'].includes(cam.projection)) throw new Error('camera.projection must be perspective or orthographic')
    const margin = num('camera.margin', cam.margin, 1.08)
    if (margin < 1) throw new Error('camera.margin must be at least 1')
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
    if (height <= 0) throw new Error('camera.height must be positive')
    return { kind: 'ortho', ...placed(cam), height }
  }
  throw new Error('camera must have a type: fit, perspective, orthographic or asset')
}

function lightsWire(lights: RenderOptions['lights']) {
  if (lights === undefined || lights === 'asset' || lights === 'default') return null
  if (!Array.isArray(lights)) throw new Error('lights must be asset, default or an array')
  return lights.map(light => {
    if (!light || !['directional', 'point', 'spot'].includes(light.type)) throw new Error('light.type must be directional, point or spot')
    const color = vec3('light.color', light.color ?? [1, 1, 1])
    if (color.some(n => n < 0 || n > 1)) throw new Error('light.color must be between 0 and 1')
    const intensity = num('light.intensity', light.intensity, 1)
    if (intensity < 0) throw new Error('light.intensity must be non-negative')
    const range = 'range' in light && light.range !== undefined ? finite('light.range', light.range) : null
    if (range !== null && (range <= 0 || light.type === 'directional')) throw new Error('light.range must be positive and only applies to point/spot lights')
    const innerConeAngle = light.type === 'spot' ? num('innerConeAngle', light.innerConeAngle, 0) : 0
    const outerConeAngle = light.type === 'spot' ? num('outerConeAngle', light.outerConeAngle, Math.PI / 4) : Math.PI / 4
    if (innerConeAngle < 0 || innerConeAngle >= outerConeAngle || outerConeAngle > Math.PI / 2)
      throw new Error('spot angles must satisfy 0 <= innerConeAngle < outerConeAngle <= PI/2')
    return {
      type: light.type,
      color,
      intensity,
      range,
      innerConeAngle,
      outerConeAngle,
      position: light.type === 'directional' ? [0, 0, 0] : vec3('light.position', light.position),
      direction: light.type === 'point' ? [0, 0, -1] : direction('light.direction', light.direction),
    }
  })
}

function checkOptions(name: string, value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} options must be an object`)
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`unknown ${name} option: ${key}`)
}

export function loadWire(options: LoadOptions = {}) {
  checkOptions('load', options, ['scene', 'baseColorSpace', 'unsupported'] satisfies (keyof LoadOptions)[])
  const scene = options.scene === undefined ? undefined : index('scene', options.scene)
  const baseColorSpace = options.baseColorSpace ?? 'linear'
  const unsupported = options.unsupported ?? 'warn'
  if (!['linear', 'srgb'].includes(baseColorSpace)) throw new Error('baseColorSpace must be linear or srgb')
  if (!['warn', 'error'].includes(unsupported)) throw new Error('unsupported must be warn or error')
  return { scene, baseColorSpace, unsupported }
}

function shadowsWire(shadows: RenderOptions['shadows']) {
  if (shadows === undefined || shadows === false) return null
  if (shadows !== true && (!shadows || typeof shadows !== 'object' || Array.isArray(shadows))) throw new Error('shadows must be a boolean or shadow options')
  const options = shadows === true ? {} : shadows
  const resolution = size('shadows.resolution', options.resolution ?? 1024)
  if (resolution < 256 || resolution > 2048) throw new Error('shadows.resolution must be between 256 and 2048')
  const strength = num('shadows.strength', options.strength, 1)
  if (strength < 0 || strength > 1) throw new Error('shadows.strength must be between 0 and 1')
  return { resolution, strength }
}

function transparencyWire(options: RenderOptions['transparency']) {
  if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) throw new Error('transparency must be an options object')
  const maxLayers = size('transparency.maxLayers', options?.maxLayers ?? 32)
  if (maxLayers > 128) throw new Error('transparency.maxLayers must be between 1 and 128')
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
    'background',
    'highlight',
    'nodeTranslations',
  ] satisfies (keyof RenderOptions)[])
  const width = size('width', opts.width)
  const height = size('height', opts.height)
  if (width > 4096 || height > 4096) throw new Error(`image is ${width} by ${height} before supersampling; the limit is 4096 by 4096`)
  const supersample = opts.supersample === undefined ? 2 : size('supersample', opts.supersample)
  if (supersample > 8) throw new Error(`supersample ${supersample} is outside 1 to 8`)
  if (width * supersample > 8192 || height * supersample > 8192)
    throw new Error(`supersampled image is ${width * supersample} by ${height * supersample}; the limit is 8192 along an edge`)
  const background = opts.background === 'transparent' ? [0, 0, 0, 0] : opts.background === undefined ? DEFAULT_BG : opts.background
  if (!Array.isArray(background) || background.length !== 4 || ![0, 1, 2, 3].every(i => typeof background[i] === 'number' && Number.isFinite(background[i])))
    throw new Error('background must be four finite numbers or "transparent"')
  const camera = cameraWire(opts.camera)
  const highlight = opts.highlight?.nodes ?? []
  if ((opts.highlight && !Array.isArray(opts.highlight.nodes)) || !Array.from(highlight).every(n => typeof n === 'string' || (Number.isSafeInteger(n) && Number(n) >= 0)))
    throw new Error('highlight.nodes must contain names or non-negative node indices')
  const lightDir = vec3('light.direction', opts.light?.direction ?? DEFAULT_LIGHT)
  if (Math.hypot(...lightDir) < 1e-8) throw new Error('light direction must be a non-zero finite vector')
  const lighting = opts.lighting ?? 'classic'
  if (lighting !== 'classic' && lighting !== 'studio') throw new Error('lighting must be classic or studio')
  const exposure = num('exposure', opts.exposure, 0)
  if (exposure < -20 || exposure > 20) throw new Error('exposure must be between -20 and 20 stops')
  const toneMapping = opts.toneMapping ?? 'none'
  if (!['none', 'reinhard', 'aces'].includes(toneMapping)) throw new Error('toneMapping must be none, reinhard or aces')
  if (opts.nodeTranslations !== undefined && !Array.isArray(opts.nodeTranslations)) throw new Error('nodeTranslations must be an array')
  const clip = opts.camera?.type === 'perspective' || opts.camera?.type === 'orthographic' ? opts.camera : undefined
  const near = clip?.near === undefined ? null : finite('camera.near', clip.near)
  const far = clip?.far === undefined ? null : finite('camera.far', clip.far)
  if ((near !== null && (near < 0 || (clip?.type === 'perspective' && near === 0))) || (far !== null && far <= (near ?? 0)))
    throw new Error('camera clipping planes need near < far and a positive perspective near')
  return {
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
    nodeTranslations: (opts.nodeTranslations ?? []).map(t => ({ node: index('nodeTranslations.node', t.node), translation: vec3('nodeTranslations.translation', t.translation) })),
    detail: opts.detail === true,
    highlight: highlight.filter(n => typeof n === 'string'),
    highlightIndices: highlight.filter(n => typeof n === 'number'),
    dim: num('highlight.dim', opts.highlight?.dim, 0.25),
    camera,
  }
}
