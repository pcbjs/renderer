# Docs

```sh
npm install
npm run dev
```

Build the package first so `../build/pkg` exists.

## GitHub Pages

In the repository's Settings → Pages, select GitHub Actions as the build and deployment source. `.github/workflows/pages.yml` builds the package and docs, then deploys on pushes to `main`. It can also be run manually from Actions.

The workflow reads the site's base path from GitHub Pages, so assets, demo models and links work under `/renderer/` or a configured custom domain. Local builds use `/`; set `DOCS_BASE=/renderer/` to preview the project path. Generated links include `.html` so direct page navigation works on static hosting.
