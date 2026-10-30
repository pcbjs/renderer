<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ViewerControls from './ViewerControls.vue'
import { defaultSettings, type ViewPreset } from '../../viewer-controls'
import { Scene } from '../../../build/pkg/renderer.js'
import wasmUrl from '../../../build/pkg/renderer_bg.wasm?url'
import { blinkyScene, psuScene } from '../../boards.mjs'
import { bunnyScene } from '../../bunny.mjs'
import { materialsScene } from '../../materials.mjs'
import { transparencyScene } from '../../transparency.mjs'
import type { AssetInfo } from '../../../src/options.ts'
import { loadRenderer } from '../../load-renderer.mjs'
import { teapotScene } from '../../teapot.mjs'
import { wire } from '../../../src/options.ts'
import { basis, isoAngles, viewAngles, sunViewOf, sunWorld } from '../../camera'

const MODELS = [
  { id: 'blinky', title: 'Blinky', load: blinkyScene },
  { id: 'psu', title: 'PSU', load: psuScene },
  { id: 'teapot', title: 'Teapot', load: teapotScene },
  { id: 'bunny', title: 'Bunny', load: bunnyScene },
  { id: 'materials', title: 'Materials', load: materialsScene },
  { id: 'transparency', title: 'Transparency', load: transparencyScene },
] as const

type ModelId = (typeof MODELS)[number]['id']

const WINDOW = 30
const FOV = 35
const stage = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const modelId = ref<ModelId>('blinky')
const previews = ref<Partial<Record<ModelId, string>>>({})
const mean = ref(0)
const median = ref(0)
const worst = ref(0)
const samples = ref(0)
const triangles = ref(0)
const sizeLabel = ref('')
const status = ref('Loading the renderer')
const controls = ref({ ...defaultSettings })
const ready = ref(false)
const activeView = ref<ViewPreset | null>('iso')
const nodes = ref<AssetInfo['nodes']>([])
const namedNodes = computed(() => nodes.value.map(node => ({ index: node.index, name: node.name ?? `Node ${node.index}` })))
const offsets = computed(() =>
  nodes.value.flatMap(node => {
    const offset = (node.extras as { explode?: unknown } | null)?.explode
    return Array.isArray(offset) && offset.length === 3 && offset.every(n => typeof n === 'number' && Number.isFinite(n))
      ? [{ node: node.index, offset: offset as [number, number, number] }]
      : []
  }),
)

let scene: Scene | undefined
let modelTarget: [number, number, number] = [0, 0, 0]
let target: [number, number, number] = [0, 0, 0]
let fit = 0.08
let azimuth = isoAngles().azimuth
let elevation = isoAngles().elevation
let zoom = 1
let alive = true
let fine = false
let settleTimer = 0
let frameRequest = 0
let ticket = 0
let viewSun: [number, number, number] = [0, 1, 0]
const times: number[] = []

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function resetReadout() {
  times.length = 0
  mean.value = 0
  median.value = 0
  worst.value = 0
  samples.value = 0
}

function note(ms: number) {
  times.push(ms)
  if (times.length > WINDOW) times.shift()
  const sorted = [...times].sort((a, b) => a - b)
  mean.value = times.reduce((s, n) => s + n, 0) / times.length
  median.value = sorted[Math.floor((sorted.length - 1) / 2)]
  worst.value = sorted[sorted.length - 1]
  samples.value = times.length
}

function poseIso() {
  activeView.value = 'iso'
  zoom = 1
  azimuth = isoAngles().azimuth
  elevation = isoAngles().elevation
}

function camera() {
  const distance = fit * zoom * aspectFit()
  const ce = Math.cos(elevation)
  const position: [number, number, number] = [
    target[0] + ce * Math.sin(azimuth) * distance,
    target[1] + Math.sin(elevation) * distance,
    target[2] + ce * Math.cos(azimuth) * distance,
  ]
  const up: [number, number, number] = [0, 1, 0]
  if (controls.value.orthographic) return { type: 'orthographic' as const, position, target, up, height: fit * 0.72 * zoom * aspectFit() }
  return { type: 'perspective' as const, position, target, up, fov: FOV }
}

function pixels() {
  const el = stage.value
  if (!el) return { width: 2, height: 2 }
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  return { width: Math.max(2, Math.round(el.clientWidth * dpr)), height: Math.max(2, Math.round(el.clientHeight * dpr)) }
}

function paint(rgba: Uint8Array, width: number, height: number) {
  const el = canvas.value
  if (!el) return
  el.width = width
  el.height = height
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  sizeLabel.value = `${width}×${height}`
}

function frame() {
  if (!scene || !alive || !ready.value) return
  const settled = fine
  const { width, height } = pixels()
  const cam = camera()
  const eye = cam.position
  const aim = cam.target
  const up = cam.up
  const started = performance.now()
  try {
    const body = wire({
      width,
      height,
      supersample: settled ? settledSamples(width, height) : 1,
      camera: cam,
      light: {
        direction: sunWorld(eye, aim, up, viewSun),
        ambient: 0.12,
        hemisphere: 0.48,
      },
      lighting: controls.value.lighting,
      exposure: controls.value.exposure,
      toneMapping: controls.value.toneMapping,
      shadows: controls.value.shadows ? { resolution: settled ? 1024 : 512 } : false,
      detail: true,
      background: controls.value.transparent ? 'transparent' : undefined,
      nodeTranslations: offsets.value.map(({ node, offset }) => ({
        node,
        translation: offset.map(n => n * controls.value.separation) as [number, number, number],
      })),
      ...(controls.value.focusNode !== null ? { highlight: { nodes: [controls.value.focusNode], dim: controls.value.dim } } : {}),
    })
    const rgba = scene.render(JSON.stringify(body))
    if (!settled) note(performance.now() - started)
    paint(rgba, body.width, body.height)
    status.value = ''
  } catch (err) {
    status.value = err instanceof Error ? err.message : 'Render failed'
  }
}

async function open(id: ModelId) {
  const spec = MODELS.find(item => item.id === id)
  if (!spec) return
  const mine = ++ticket
  status.value = `Loading ${spec.title}`
  ready.value = false
  try {
    const model = await spec.load()
    if (!alive || mine !== ticket) return
    const next = new Scene(model.glb, JSON.stringify({ baseColorSpace: 'srgb' }))
    scene?.free()
    scene = next
    nodes.value = (JSON.parse(next.info()) as AssetInfo).nodes
    modelId.value = id
    modelTarget = [...model.target]
    target = [...modelTarget]
    fit = (model.span / (2 * Math.tan((FOV * Math.PI) / 360))) * 1.45
    controls.value = { ...controls.value, focusNode: null, separation: 0 }
    ready.value = true
    poseIso()
    resetReadout()
    triangles.value = next.triangles
    const start = camera()
    viewSun = sunViewOf(start.position, start.target, start.up ?? [0, 1, 0])
    show()
  } catch (err) {
    if (alive && mine === ticket) {
      status.value = err instanceof Error ? err.message : 'Model failed to load'
      ready.value = Boolean(scene)
    }
  }
}

function cropSolid(rgba: Uint8Array, width: number, height: number) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] <= 8) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return { rgba, width, height }
  const pad = 4
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(width - 1, maxX + pad)
  maxY = Math.min(height - 1, maxY + pad)
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) out.set(rgba.subarray(((y + minY) * width + minX) * 4, ((y + minY) * width + maxX + 1) * 4), y * w * 4)
  return { rgba: out, width: w, height: h }
}

async function thumbnail(load: () => Promise<{ glb: Uint8Array }> | { glb: Uint8Array }) {
  const model = await load()
  const thumb = new Scene(model.glb, JSON.stringify({ baseColorSpace: 'srgb' }))
  try {
    const width = 360
    const height = 240
    const body = wire({
      width,
      height,
      supersample: settledSamples(width, height),
      camera: { type: 'fit', direction: [0.55, 0.9, 0.95] },
      background: 'transparent',
      light: { ambient: 0.12, hemisphere: 0.48 },
      detail: true,
    })
    const shot = cropSolid(thumb.render(JSON.stringify(body)), body.width, body.height)
    const el = document.createElement('canvas')
    el.width = shot.width
    el.height = shot.height
    const ctx = el.getContext('2d')
    if (!ctx) return ''
    ctx.putImageData(new ImageData(new Uint8ClampedArray(shot.rgba), shot.width, shot.height), 0, 0)
    return el.toDataURL('image/png')
  } finally {
    thumb.free()
  }
}

function settledSamples(width: number, height: number) {
  const budget = 8_000_000
  for (const ss of [3, 2]) {
    if (width * ss <= 8192 && height * ss <= 8192 && width * height * ss * ss <= budget) return ss
  }
  return 1
}

function preview() {
  window.clearTimeout(settleTimer)
  fine = false
  if (!frameRequest)
    frameRequest = requestAnimationFrame(() => {
      frameRequest = 0
      frame()
    })
}

function settle(wait = 160) {
  window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    cancelAnimationFrame(frameRequest)
    frameRequest = 0
    fine = true
    frame()
  }, wait)
}

function show() {
  preview()
  settle(40)
}

function choose(id: ModelId) {
  if (id === modelId.value) return
  open(id)
}

const pointers = new Map<number, { x: number; y: number }>()
let panDrag = false
function aspectFit() {
  const el = stage.value
  return el ? Math.max(1, el.clientHeight / Math.max(1, el.clientWidth)) : 1
}
function panScale() {
  const distance = fit * zoom * aspectFit()
  const px = stage.value?.clientHeight || 520
  if (controls.value.orthographic) return (fit * 0.72 * zoom * aspectFit()) / px
  return (2 * distance * Math.tan((FOV * Math.PI) / 360)) / px
}
function panBy(dx: number, dy: number) {
  const cam = camera()
  const { right, up } = basis(cam.position, cam.target, cam.up)
  const scale = panScale()
  target[0] -= (dx * right[0] - dy * up[0]) * scale
  target[1] -= (dx * right[1] - dy * up[1]) * scale
  target[2] -= (dx * right[2] - dy * up[2]) * scale
}
function orbitBy(dx: number, dy: number) {
  azimuth -= dx * 0.008
  elevation = clamp(elevation + dy * 0.008, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001)
  activeView.value = null
}
function down(event: PointerEvent) {
  if (!ready.value || ![0, 1, 2].includes(event.button)) return
  const element = event.currentTarget as HTMLCanvasElement
  element.focus({ preventScroll: true })
  element.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  panDrag = event.button !== 0 || event.shiftKey
}
function gesture() {
  const [a, b] = [...pointers.values()]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }
}
function move(event: PointerEvent) {
  const previous = pointers.get(event.pointerId)
  if (!previous) return
  const before = pointers.size === 2 ? gesture() : null
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (before) {
    const after = gesture()
    panBy(after.x - before.x, after.y - before.y)
    if (after.distance > 0) zoom = clamp((zoom * before.distance) / after.distance, 0.15, 8)
  } else if (pointers.size === 1) {
    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    if (panDrag || event.shiftKey) panBy(dx, dy)
    else orbitBy(dx, dy)
  }
  preview()
}
function up(event: PointerEvent) {
  if (!pointers.delete(event.pointerId)) return
  const element = event.currentTarget as HTMLCanvasElement
  if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
  if (!pointers.size) settle(40)
}
function wheel(event: WheelEvent) {
  if (!ready.value) return
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.value?.clientHeight || 480 : 1
  zoom = clamp(zoom * Math.exp(event.deltaY * unit * 0.0011), 0.15, 8)
  preview()
  settle(160)
}
function look(kind: ViewPreset) {
  if (!ready.value) return
  target = [...modelTarget]
  zoom = 1
  if (kind !== 'fit') {
    const angles = viewAngles(kind)
    azimuth = angles.azimuth
    elevation = angles.elevation
    activeView.value = kind
  }
  show()
}
function keydown(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey || !ready.value) return
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }
  const arrow = arrows[event.key]
  if (arrow) {
    if (event.shiftKey) panBy(...arrow)
    else orbitBy(...arrow)
  } else if (event.key === '+' || event.key === '=') zoom = clamp(zoom / 1.15, 0.15, 8)
  else if (event.key === '-') zoom = clamp(zoom * 1.15, 0.15, 8)
  else if (event.key.toLowerCase() === 'f') {
    event.preventDefault()
    look('fit')
    return
  } else return
  event.preventDefault()
  show()
}
function settingsChanged() {
  resetReadout()
  show()
}

let observer: ResizeObserver | undefined
onMounted(async () => {
  try {
    await loadRenderer(wasmUrl)
    if (!alive) return
    observer = new ResizeObserver(() => show())
    if (stage.value) observer.observe(stage.value)
    await open('blinky')
    for (const item of MODELS) {
      if (!alive) return
      previews.value = { ...previews.value, [item.id]: await thumbnail(item.load) }
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
  } catch (err) {
    status.value = err instanceof Error ? err.message : 'The renderer failed to load'
  }
})
onBeforeUnmount(() => {
  alive = false
  window.clearTimeout(settleTimer)
  cancelAnimationFrame(frameRequest)
  pointers.clear()
  observer?.disconnect()
  scene?.free()
})

const ms = (n: number) => (samples.value ? n.toFixed(1) : '–')
</script>

<template>
  <div class="viewer">
    <div class="workspace">
      <aside class="models" aria-label="Models">
        <button v-for="item in MODELS" :key="item.id" type="button" :aria-pressed="modelId === item.id" :class="{ on: modelId === item.id }" @click="choose(item.id)">
          <img v-if="previews[item.id]" :src="previews[item.id]" alt="" />
          <span v-else class="ph" />
          <span class="name">{{ item.title }}</span>
        </button>
      </aside>
      <div class="main">
        <div ref="stage" class="stage" :class="{ clear: controls.transparent }">
          <canvas
            ref="canvas"
            tabindex="0"
            role="img"
            aria-label="Interactive 3D model. Drag to orbit, Shift-drag to pan, scroll to zoom, or press F to fit."
            @pointerdown="down"
            @pointermove="move"
            @pointerup="up"
            @pointercancel="up"
            @lostpointercapture="up"
            @wheel.prevent="wheel"
            @contextmenu.prevent
            @dblclick="look('fit')"
            @keydown="keydown"
          />
          <ViewerControls v-model="controls" :ready="ready" :view="activeView" :nodes="namedNodes" :can-explode="offsets.length > 0" @view="look" @change="settingsChanged" />
        </div>
        <div class="readout" aria-live="off">
          <p v-if="status" role="status">{{ status }}</p>
          <template v-else>
            <span class="timing" :title="`Last ${samples} preview frames: ${ms(median)} ms median, ${ms(worst)} ms worst`">{{ ms(mean) }} ms <span>mean</span></span>
            <span
              >{{ sizeLabel }} <span class="triangle-count">· {{ triangles.toLocaleString() }} triangles</span></span
            >
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.viewer {
  margin: 0 0 36px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  background: var(--vp-c-bg);
}
.workspace {
  display: flex;
  align-items: stretch;
  min-height: 552px;
}
.models {
  width: 160px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-right: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.models button {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--vp-c-text-2);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.models button:hover {
  background: var(--vp-c-default-soft);
}
.models button.on {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
.models button:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}
.models img,
.models .ph {
  width: 40px;
  height: 30px;
  flex: none;
  object-fit: contain;
  display: block;
  border: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 520px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}
.stage.clear {
  --checker: color-mix(in srgb, var(--vp-c-text-1) 6%, var(--vp-c-bg));
  background-color: var(--vp-c-bg);
  background-image:
    linear-gradient(45deg, var(--checker) 25%, transparent 25%), linear-gradient(-45deg, var(--checker) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--checker) 75%), linear-gradient(-45deg, transparent 75%, var(--checker) 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0;
}
.stage canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  cursor: grab;
}
.stage canvas:active {
  cursor: grabbing;
}
.stage canvas:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}
.readout {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 16px;
  min-height: 30px;
  padding: 6px 10px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 11px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.readout p {
  margin: 0;
}
.timing {
  color: var(--vp-c-text-1);
}
.timing span {
  color: var(--vp-c-text-2);
}
@media (max-width: 800px) {
  .workspace {
    flex-direction: column;
    min-height: 0;
  }
  .models {
    width: auto;
    flex-direction: row;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--vp-c-divider);
    padding: 6px;
  }
  .models button {
    width: auto;
    flex: none;
    padding: 4px 8px;
  }
  .models img,
  .models .ph {
    width: 32px;
    height: 28px;
  }
  .stage {
    flex: none;
    min-height: 0;
    height: 420px;
  }
}
@media (max-width: 420px) {
  .triangle-count {
    display: none;
  }
}
</style>
