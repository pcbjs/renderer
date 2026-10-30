<!-- ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { defaultSettings, type ViewerSettings, type ViewPreset } from '../../viewer-controls'

const settings = defineModel<ViewerSettings>({ required: true })
defineProps<{ ready: boolean; view: ViewPreset | null; nodes: { index: number; name: string }[]; canExplode: boolean }>()
const emit = defineEmits<{ view: [ViewPreset]; change: [] }>()
const host = ref<HTMLElement>()
const panel = ref<HTMLElement>()
const open = ref<'render' | 'help' | null>(null)
let trigger: HTMLButtonElement | null = null

function set<K extends keyof ViewerSettings>(key: K, value: ViewerSettings[K]) {
  settings.value = { ...settings.value, [key]: value }
  emit('change')
}
function chooseView(view: ViewPreset) {
  emit('view', view)
  close()
}
function reset() {
  settings.value = { ...defaultSettings }
  emit('change')
}
async function togglePanel(kind: 'render' | 'help', event: MouseEvent) {
  if (open.value === kind) return close()
  trigger = event.currentTarget as HTMLButtonElement
  open.value = kind
  await nextTick()
  panel.value?.focus()
}
function close(restoreFocus = false) {
  open.value = null
  if (restoreFocus) trigger?.focus()
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !host.value?.contains(event.target)) close()
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="host" class="controls" @pointerdown.stop @wheel.stop @keydown.esc.stop.prevent="close(true)">
    <div class="toolbar" role="group" aria-label="View controls">
      <button type="button" class="icon" :disabled="!ready" title="Fit model (F)" aria-label="Fit model" @click="chooseView('fit')">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
      </button>
      <button type="button" class="icon" :disabled="!ready" :aria-pressed="view === 'top'" title="Top view" aria-label="Top view" @click="chooseView('top')">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="7" width="10" height="6" rx="1" />
          <path d="M8 1.5v4M6 3.8L8 5.8l2-2" />
        </svg>
      </button>
      <button type="button" class="icon" :disabled="!ready" :aria-pressed="view === 'bottom'" title="Bottom view" aria-label="Bottom view" @click="chooseView('bottom')">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="3" width="10" height="6" rx="1" />
          <path d="M8 14.5v-4M6 12.2L8 10.2l2 2" />
        </svg>
      </button>
      <button type="button" class="icon" :disabled="!ready" :aria-pressed="view === 'iso'" title="Isometric view" aria-label="Isometric view" @click="chooseView('iso')">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l5.5 3v6L8 14l-5.5-3V5zM8 8l5.5-3M8 8v6M8 8L2.5 5" /></svg>
      </button>
      <span class="separator" aria-hidden="true" />
      <button
        type="button"
        class="icon"
        :disabled="!ready"
        :aria-pressed="settings.orthographic"
        title="Orthographic projection"
        aria-label="Orthographic projection"
        @click="set('orthographic', !settings.orthographic)"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="3" width="10" height="10" rx="1" />
          <path d="M3 6h10M6 3v10" />
        </svg>
      </button>
      <button
        type="button"
        class="icon"
        :disabled="!ready"
        :aria-expanded="open === 'render'"
        aria-controls="viewer-render-settings"
        title="Rendering settings"
        aria-label="Rendering settings"
        @click="togglePanel('render', $event)"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h3m4 0h5M2 8h7m4 0h1M2 12h1m4 0h7" />
          <circle cx="7" cy="4" r="2" />
          <circle cx="11" cy="8" r="2" />
          <circle cx="5" cy="12" r="2" />
        </svg>
      </button>
      <button
        type="button"
        class="icon"
        :aria-expanded="open === 'help'"
        aria-controls="viewer-help"
        title="Navigation help"
        aria-label="Navigation help"
        @click="togglePanel('help', $event)"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M6.5 5.5a1.5 1.5 0 0 1 3 0C9.5 7 8 7 8 8.5M8 11h.01" />
        </svg>
      </button>
    </div>
    <section v-if="open === 'render'" id="viewer-render-settings" ref="panel" class="panel" tabindex="-1" role="dialog" aria-label="Rendering settings">
      <header>
        <h3>Rendering</h3>
        <button type="button" class="close" aria-label="Close rendering settings" @click="close(true)">×</button>
      </header>
      <div class="fields">
        <div class="field">
          <span>Lighting</span>
          <div class="segment" role="group" aria-label="Lighting">
            <button type="button" :aria-pressed="settings.lighting === 'classic'" @click="set('lighting', 'classic')">Classic</button>
            <button type="button" :aria-pressed="settings.lighting === 'studio'" @click="set('lighting', 'studio')">Studio</button>
          </div>
        </div>
        <label class="field">Shadows<input type="checkbox" :checked="settings.shadows" @change="set('shadows', ($event.target as HTMLInputElement).checked)" /></label>
        <label class="field"
          >Transparent background<input type="checkbox" :checked="settings.transparent" @change="set('transparent', ($event.target as HTMLInputElement).checked)"
        /></label>
        <label class="field"
          >Tone mapping<select :value="settings.toneMapping" @change="set('toneMapping', ($event.target as HTMLSelectElement).value as ViewerSettings['toneMapping'])">
            <option value="none">None</option>
            <option value="reinhard">Reinhard</option>
            <option value="aces">ACES fit</option>
          </select></label
        >
        <label class="slider"
          >Exposure<output>{{ settings.exposure > 0 ? '+' : '' }}{{ settings.exposure }} EV</output>
          <input type="range" min="-3" max="3" step="0.25" :value="settings.exposure" @input="set('exposure', Number(($event.target as HTMLInputElement).value))" />
        </label>
      </div>
      <div v-if="nodes.length || canExplode" class="fields scene-fields">
        <label v-if="nodes.length" class="field"
          >Focus<select
            :value="settings.focusNode ?? ''"
            @change="set('focusNode', ($event.target as HTMLSelectElement).value === '' ? null : Number(($event.target as HTMLSelectElement).value))"
          >
            <option value="">Whole scene</option>
            <option v-for="node in nodes" :key="node.index" :value="node.index">{{ node.name }}</option>
          </select></label
        >
        <label v-if="settings.focusNode !== null" class="slider"
          >Dim other nodes<output>{{ Math.round(settings.dim * 100) }}%</output>
          <input type="range" min="0" max="1" step="0.05" :value="settings.dim" @input="set('dim', Number(($event.target as HTMLInputElement).value))" />
        </label>
        <label v-if="canExplode" class="slider"
          >Exploded view<output>{{ Math.round(settings.separation * 100) }}%</output>
          <input type="range" min="0" max="1" step="0.05" :value="settings.separation" @input="set('separation', Number(($event.target as HTMLInputElement).value))" />
        </label>
      </div>
      <footer><button type="button" @click="chooseView('front')">Front view</button><button type="button" @click="reset">Reset settings</button></footer>
    </section>
    <section v-if="open === 'help'" id="viewer-help" ref="panel" class="panel help" tabindex="-1" role="dialog" aria-label="Navigation help">
      <header>
        <h3>Navigation</h3>
        <button type="button" class="close" aria-label="Close navigation help" @click="close(true)">×</button>
      </header>
      <dl>
        <dt>Orbit</dt>
        <dd>Drag · Arrow keys</dd>
        <dt>Pan</dt>
        <dd>Right-drag · Shift-drag</dd>
        <dt>Zoom</dt>
        <dd>Scroll · Pinch · + / −</dd>
        <dt>Fit model</dt>
        <dd>Double-click · F</dd>
        <dt>Touch</dt>
        <dd>One finger to orbit<br />Two fingers to pan and zoom</dd>
      </dl>
      <p>Keyboard shortcuts work when the canvas is focused.</p>
    </section>
  </div>
</template>

<style scoped>
.controls {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  max-width: calc(100% - 16px);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
}
button {
  cursor: pointer;
}
.icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}
.icon svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
button:hover,
.icon[aria-pressed='true'],
.icon[aria-expanded='true'] {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
.panel:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.separator {
  width: 4px;
}
.panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 280px;
  max-width: calc(100vw - 80px);
  max-height: 360px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  box-shadow: 0 6px 20px #0002;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: default;
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
}
header,
.field,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
header {
  margin-bottom: 12px;
}
h3 {
  font-size: 13px;
  font-weight: 600;
}
.close {
  width: 24px;
  height: 24px;
  font-size: 22px;
  line-height: 1;
  border-radius: 4px;
}
.fields {
  display: grid;
  gap: 12px;
}
.field select {
  min-width: 0;
  max-width: 148px;
  padding: 4px 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font: inherit;
}
input {
  accent-color: var(--vp-c-brand-1);
}
input[type='checkbox'] {
  width: 16px;
  height: 16px;
}
.segment {
  display: flex;
}
.segment button,
footer button {
  border: 1px solid var(--vp-c-divider);
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
}
.segment button {
  border-radius: 0;
}
.segment button:first-child {
  border-radius: 4px 0 0 4px;
}
.segment button:last-child {
  border-radius: 0 4px 4px 0;
  margin-left: -1px;
}
.segment [aria-pressed='true'] {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
.slider {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 12px;
}
.slider input {
  grid-column: 1 / -1;
  width: 100%;
  margin: 0;
}
output {
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
}
.scene-fields,
footer {
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 12px;
  margin-top: 12px;
}
.help dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px 16px;
}
.help dd,
.help p {
  color: var(--vp-c-text-2);
}
.help p {
  margin-top: 14px;
}
@media (max-width: 600px), (pointer: coarse) {
  .icon {
    width: 36px;
    height: 36px;
  }
  .panel {
    max-height: 300px;
  }
}
@media (max-width: 380px) {
  .toolbar {
    gap: 2px;
  }
  .icon {
    width: 34px;
    height: 34px;
  }
  .separator {
    display: none;
  }
}
</style>
