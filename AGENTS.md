# AGENTS.md

Guidance for agents working in this repository.

## What this is

`@pcbjs/renderer` is a CPU rasteriser compiled to WebAssembly. It turns a glTF 2.0 binary into an RGBA image. pcbjs plans to use it for headless 3D shots. Keep it generic: nodes, materials, cameras, pixels. No pad, layer or board concepts belong here.

Prioritize CPU rendering correctness, throughput, memory efficiency and API clarity. GPU support is not planned in the near future. Do not constrain features, data structures or algorithms for GPU compatibility, or add abstractions solely for a future GPU backend. The local `experimental/webgpu` branch is dormant; do not keep it synchronized or resume GPU work without an explicit request. Any future GPU implementation must adapt to the CPU renderer's requirements.

The GLB is metres, Y up, right-handed. pcbjs converts on export, millimetres and Z up `(x, y, z)` to `(x / 1000, z / 1000, -y / 1000)`. The renderer accepts explicit fit directions. The docs viewer keeps its application presets: `iso` is the viewer `ISO_DIR` of `(0.55, -0.95, 0.9)` run through that same conversion. Do not flip a sign without a test that fails first.

## Documentation

- [BACKLOG.md](BACKLOG.md) holds the current plan, ownership boundaries, acceptance checks and deferred work. Update it when scope changes and remove completed tasks rather than appending another review.
- [docs/api.md](docs/api.md), [docs/architecture.md](docs/architecture.md) and [docs/specification.md](docs/specification.md) describe implemented behavior and verification evidence. Planned APIs stay in the backlog until implemented.
- [CHANGELOG.md](CHANGELOG.md) records completed changes; [PUBLISHING.md](PUBLISHING.md) is the release procedure; [docs/README.md](docs/README.md) covers docs development and hosting.

## Layout

```
src/               TypeScript API.
src/core/          Rust rasteriser. wasm32-unknown-unknown. Crate root is src/core/lib.rs.
src/core/gltf/     GLB loading, checked accessors and image decoding.
src/core/model.rs  Runtime scene data, independent of glTF parsing.
src/core/geometry.rs   Projection, clipping and triangle preparation.
src/core/material.rs   Surface sampling and lighting.
src/core/raster.rs     Coverage, interpolation and depth testing.
src/core/framebuffer.rs   Banded storage, straight-alpha resolve and outlines.
src/core/frame.rs   Shared camera and translated-bounds preparation.
src/index.ts       Node entry point: render, createRenderer, encodePng. PNG only.
src/renderer.ts    Scene lifetime and rendering, independent of filesystem loading.
src/options.ts     Option checks. The wasm call receives JSON.stringify(wire(opts)).
src/png.ts         PNG encoder. node:zlib in Node, stored deflate otherwise.
src/load.ts        The only file that calls node:fs.
test/              node:test against dist/. Scenes are built in memory.
scripts/           Rollup, dist package, tiny test scenes, bench, pack smoke.
docs/              VitePress docs. The demo model is docs/model.mjs.
```

`dist/` is the published package. `build/` is cargo output and the wasm-bindgen package. Both are gitignored. Do not commit PNG, GLB or wasm, except the docs viewer models in `docs/public/models/`.

## Toolchain

- rustc 1.99.1, pinned in `rust-toolchain.toml`
- cargo 1.99.1
- wasm-bindgen and wasm-bindgen-cli 0.2.129, pinned together in `Cargo.toml`
- Node 22 or later
- Release wasm: `lto`, `codegen-units = 1`, `opt-level = 3`, `panic = abort` on the wasm target only

Install `wasm32-unknown-unknown` and `wasm-bindgen-cli` 0.2.129 if they are missing. A CLI that does not match the crate version fails the bindgen step.

## Commands

- `npm install`
- `npm run build` builds the wasm, typechecks, then rollup. Tests import `dist/`, so build first.
- `npm test` runs `node --test` against `dist/`.
- `npm run bench` prints load time, render time and triangles per second for a 300k and a 1M triangle grid at 1600 by 1000 with supersample 2. The budgets are 2 s and 10 s of render time on a laptop. CI prints the numbers and does not fail on them.
- `npm run pack-smoke` installs `dist/` into a temp project and renders a generated cube.
- `npm run docs` serves the docs. `npm run docs:build` builds them. Build the package first so `build/pkg` exists. `.github/workflows/pages.yml` deploys to GitHub Pages on pushes to `main`; select GitHub Actions as the Pages source first.

## Environment

This machine's zsh defines `node` and `npm` functions that recurse. Call `/opt/homebrew/bin/node` and `/opt/homebrew/bin/npm`. Cargo is at `$HOME/.cargo/bin/cargo` after rustup. The npm scripts put that directory on `PATH`.

Do not kill processes by pattern. Stop only a process you started, by PID.

## Publishing

CI publishes releases. Never `npm publish` from a machine, and never put a token in the tree or the environment. `PUBLISHING.md` separates the release procedure from conditional, owner-only package setup. Do not recreate existing release tags.

## Conventions

Formatting is Prettier with `printWidth` 180, no semicolons, single quotes, trailing commas, `arrowParens` avoid, `proseWrap` preserve. `simple-git-hooks` runs `lint-staged` and `cargo fmt` on commit. Do not run a formatter by hand. Rust comments and markdown stay one paragraph or list item per line, no em dash, and a comment only where the name cannot say it. MIT, copyright Yuxuan Zhang, with the header comment from this file on source files.

## Shading and highlight

`dim` is the fraction of the background mixed into nodes that are not named. 0 leaves them, 1 is the background. The outline is `#ffcc33`, drawn after downsampling from the id buffer, one output pixel.

`BLEND` materials composite in linear space using bounded depth peeling; they receive opaque/MASK shadows but do not cast them. `MASK` discards below `alphaCutoff`. Lighting is linear. Base colour factors are linear by default; `baseColorSpace: srgb` is a load-time legacy override. Colour textures are decoded from sRGB and the image is encoded once.
