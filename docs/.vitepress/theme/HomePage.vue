<script setup lang="ts">
import Viewer from './Viewer.vue'
</script>

<template>
  <div class="home">
    <section class="hero">
      <h1>
        <span class="name">Self-contained 3D Renderer</span>
        <svg class="wasm" viewBox="0 0 107.62 107.62" role="img" aria-label="WebAssembly">
          <path
            fill="#654ff0"
            d="M66.12,0c0,.19,0,.38,0,.58a12.34,12.34,0,1,1-24.68,0c0-.2,0-.39,0-.58H0V107.62H107.62V0ZM51.38,96.1,46.14,70.17H46L40.39,96.1H33.18L25,58h7.13L37,83.93h.09L42.94,58h6.67L54.9,84.25H55L60.55,58h7L58.46,96.1Zm39.26,0-2.43-8.48H75.4L73.53,96.1H66.36L75.59,58H86.83L98,96.1Z"
          />
          <polygon fill="#654ff0" points="79.87 67.39 76.76 81.37 86.44 81.37 82.87 67.39 79.87 67.39" />
        </svg>
      </h1>
      <p class="subtitle">
        Empowering agentic PCB design workflow with
        <a class="pcbjs" href="https://pcbjs.dev">
          <svg viewBox="0 0 512 512" aria-hidden="true">
            <rect class="body" x="64" y="64" width="384" height="384" rx="24" />
            <rect x="128" y="32" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="128" y="416" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="32" y="128" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="416" y="128" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="224" y="32" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="224" y="416" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="32" y="224" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="416" y="224" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="320" y="32" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="320" y="416" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="32" y="320" width="64" height="64" rx="6" fill="#E8B84F" />
            <rect x="416" y="320" width="64" height="64" rx="6" fill="#E8B84F" />
            <path d="M160 192L224 256L160 320" fill="none" stroke="#D07A3C" stroke-width="56" stroke-linecap="round" stroke-linejoin="round" />
            <rect x="288" y="320" width="96" height="32" rx="6" fill="#3FD8C8" />
          </svg>
          pcbjs
        </a>
      </p>
    </section>
    <Viewer />
    <div class="vp-doc examples">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.home {
  max-width: 1152px;
  margin: 0 auto;
  padding: 48px 24px 80px;
}
.hero {
  text-align: center;
  margin-bottom: 28px;
}
h1 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.32em;
  font-size: 48px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.02em;
}
h1 .name {
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
h1 .wasm {
  display: block;
  width: 1.15em;
  height: 1.15em;
  flex: none;
}
.subtitle {
  margin: 16px 0 0;
  font-size: 22px;
  font-weight: 500;
  line-height: 1.45;
  color: var(--vp-c-text-1);
}
.pcbjs {
  display: inline-flex;
  align-items: center;
  gap: 0.28em;
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: none;
  vertical-align: -0.12em;
}
.pcbjs:hover {
  text-decoration: underline;
}
.pcbjs svg {
  width: 1.15em;
  height: 1.15em;
  display: block;
}
.pcbjs .body {
  fill: #0f2219;
}
:global(.dark) .pcbjs .body {
  fill: #1e6b46;
}
.examples {
  margin-top: 8px;
  text-align: left;
}
@media (max-width: 800px) {
  h1 {
    font-size: 34px;
  }
  .subtitle {
    font-size: 18px;
  }
}
</style>
