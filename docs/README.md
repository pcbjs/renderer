# Docs

Run from the repository root:

```sh
npm install
npm run build
npm install --prefix docs
npm run docs
```

The package build supplies `build/pkg` for the interactive demo.

## GitHub Pages

In the repository's Settings → Pages, select GitHub Actions as the build and deployment source. `.github/workflows/pages.yml` builds the package and docs, then deploys on pushes to `main`. It can also be run manually from Actions.

The workflow reads the site's base path from GitHub Pages, so assets, demo models and links work under `/renderer/` or a configured custom domain. Local builds use `/`; set `DOCS_BASE=/renderer/` to preview the project path. Generated links include `.html` so direct page navigation works on static hosting.

## LAN preview

```sh
npm run dev --prefix docs
```

The dev server listens on all interfaces at port 8080 and accepts `dev.z-yx.net` and Cloudflare Quick Tunnel hostnames (`*.trycloudflare.com`). Point the tunnel at `http://localhost:8080`. For another custom tunnel domain, start the server with `DOCS_TUNNEL_HOST=preview.example.com npm run dev --prefix docs`.
