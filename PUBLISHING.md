# Publishing

Releases are published by CI when a `v*` tag is pushed. Never publish from a machine. Never put an npm token in the repo, the environment, or a script.

The package in this tree is `@pcbjs/renderer` at `0.1.0`. That is the first real release. The `0.0.0` placeholder is not this tree. It exists only so npm will accept a trusted publisher.

## Reserve the name, once, by hand

Do this from a terminal where npm is 11.5.1 or later, you are logged in, and a second factor can prompt you. Do not pipe the commands. Do not run them inside this repository.

1. Publish a placeholder from a temporary folder outside the repo. The folder holds only this `package.json` and nothing else. No dependencies, no code, no README.

```json
{
  "name": "@pcbjs/renderer",
  "version": "0.0.0",
  "description": "CPU renderer that turns a glTF binary into an RGBA image",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/pcbjs/renderer.git"
  }
}
```

```sh
mkdir -p /tmp/pcbjs-renderer-placeholder
cd /tmp/pcbjs-renderer-placeholder
npm publish --access public --provenance=false
```

npm asks for a one-time password or a browser confirmation. Provenance stays off because this publish is not from CI.

2. Bind the GitHub Actions workflow as the trusted publisher. Stay in a terminal that can show the second factor. Do not pipe the output.

```sh
npm trust github @pcbjs/renderer --repo pcbjs/renderer --file publish.yml --allow-publish -y
```

`npm trust list @pcbjs/renderer` shows the binding. An entry lapses if nothing publishes through it within two days, so tag `v0.1.0` soon after.

## Check the release candidate

Run the local gate before tagging:

```sh
npm run release:check
npm ci --prefix docs
npm run docs:build
npm run bench
```

The gate checks formatting, Rust lints, the WebAssembly build, Node and native tests, the specification inventory, and an installation of the packed tarball. CI also builds the docs and tests Node 22 and 24. Benchmarks report performance without blocking on machine-dependent timings. A successful local check does not publish or create a tag.

## Cut 0.1.0

`package.json` is already `0.1.0`, so `npm version` would move it. The first tag is created on the commit that should ship, after CI is green:

```sh
git tag -a v0.1.0 -m 'Release v0.1.0'
git push origin main refs/tags/v0.1.0
```

## Later releases

Below 1.0 a breaking change is a minor and a compatible change is a patch. From a clean tree:

```sh
npm version patch
git push --follow-tags
```

`minor` and `major` work the same way. `npm version` commits and tags. Do not hand-edit the version and do not create the tag yourself after this first release.

Pushing `v*` runs `.github/workflows/publish.yml`, which checks the tag against `package.json`, runs `npm run release:check`, and runs `npm publish ./dist --access public`. The root `package.json` is `private` so the root cannot be published. The workflow uses npm trusted publishing: OIDC, provenance on, no token. The runner is Node 22 or later with npm 11.21.1 or later.

pcbjs depends on this package with a caret, `^0.1.0`, and versions it on its own, not on the pcbjs release train.
