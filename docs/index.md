---
layout: page
title: pcbjs renderer
titleTemplate: false
description: Empowering agentic PCB design workflow with pcbjs
---

<script setup>
import HomePage from './.vitepress/theme/HomePage.vue'
</script>

<HomePage>

## Presets

The corner controls fit the model or choose Top, Bottom and Iso views. Front view is in Rendering settings. Orthographic keeps the current direction. Drag to orbit, Shift-drag or right-drag to pan, and scroll to zoom. With the canvas focused, F fits the model; arrow keys orbit and + / − zoom. On touch screens, use one finger to orbit and two to pan and zoom.

```ts
await render(glb, { width, height, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] } })
await render(glb, { width, height, camera: { type: 'fit', direction: [0, 1, 0.001], projection: 'orthographic' } })
```

## Select

`part:U1` is the body and the pins. `dim` fades every other node. The outline is `#ffcc33`.

```ts
await render(glb, {
  width,
  height,
  camera,
  highlight: { nodes: ['part:U1'], dim: 0.75 },
})
```

## Explode

The viewer maps application-owned explode metadata to world-space node translations. The renderer itself has no explode convention.

```ts
await render(glb, { width, height, camera, nodeTranslations: [{ node: 1, translation: [0, 0.006, 0] }] })
```

## Transparent

The viewer starts on a clear background.

```ts
const { rgba, width, height } = await render(glb, { width, height, camera, background: 'transparent' })
const png = await encodePng(rgba, width, height)
```

## One scene, many frames

```ts
const scene = await createRenderer(glb)
const iso = await scene.render({ width, height, camera: isoCamera })
const selected = await scene.render({ width, height, camera: isoCamera, highlight: { nodes: ['part:U1'], dim: 0.75 } })
scene.dispose()
```

</HomePage>
