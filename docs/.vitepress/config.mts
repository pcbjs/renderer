import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'

const github = 'https://github.com/pcbjs/renderer'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const base = process.env.DOCS_BASE || '/'

export default defineConfig({
  title: 'pcbjs renderer',
  description: 'Empowering agentic PCB design workflow with pcbjs',
  lang: 'en-US',
  base,
  cleanUrls: false,
  lastUpdated: false,
  srcExclude: ['README.md', '_generated/**'],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}brand/favicon.svg` }],
    ['meta', { name: 'theme-color', content: '#1f7a4d' }],
  ],
  markdown: { theme: { light: 'github-light', dark: 'github-dark' } },
  vite: {
    server: {
      host: '0.0.0.0',
      port: 8080,
      strictPort: true,
      allowedHosts: ['dev.z-yx.net', '.trycloudflare.com', ...(process.env.DOCS_TUNNEL_HOST ? [process.env.DOCS_TUNNEL_HOST] : [])],
      fs: { allow: [repo] },
    },
    assetsInclude: ['**/*.wasm'],
  },
  themeConfig: {
    logo: { src: '/brand/logo.svg', alt: 'pcbjs renderer' },
    siteTitle: 'pcbjs renderer',
    nav: [
      { text: 'API', link: '/api' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Specification', link: '/specification' },
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: github }],
    outline: { level: [2, 3] },
    footer: { message: 'MIT licensed.', copyright: 'Yuxuan Zhang' },
  },
})
