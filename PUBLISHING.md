# Publishing

Releases are published by CI when a `v*` tag is pushed. Never publish from a machine. Never put an npm token in the repo, the environment, or a script.

## Check the release candidate

Run the local gate before tagging:

```sh
npm run release:check
npm ci --prefix docs
npm run docs:build
npm run bench
```

The gate checks formatting, Rust lints, the WebAssembly build, Node and native tests, the specification inventory, and an installation of the packed tarball. CI also builds the docs and tests Node 22 and 24. Benchmarks report performance without blocking on machine-dependent timings. A successful local check does not publish or create a tag.

## Cut a release

Below 1.0 a breaking change is a minor and a compatible change is a patch. From a clean tree, prepare the intended increment without creating a commit or tag yet. For a minor release:

```sh
npm version minor --no-git-tag-version
```

Use `patch` instead for a patch release. Set the package version in `Cargo.toml` to the same value, then run `cargo check` to update `Cargo.lock`. Move the completed changelog entries under the intended version and release date. npm updates `package.json` and `package-lock.json`, but does not update the Rust manifests; the package smoke test requires their versions to match.

Run the release-candidate checks above with those final versions. Commit the release contents and push `main` first:

```sh
git add package.json package-lock.json Cargo.toml Cargo.lock CHANGELOG.md
git commit -m "Prepare release"
git push origin main
```

Wait for CI, including the Linux/macOS/Windows Node 22/24 runtime matrix, to pass on that exact commit. Then tag that checked commit from a clean tree and push the tag to trigger publication:

```sh
release_version=$(node -p "require('./package.json').version")
git tag "v$release_version"
git push origin "v$release_version"
```

The `--no-git-tag-version` option above leaves tag creation to this final step. Never recreate or move an existing release tag. `v0.1.0` already exists; the initial-tag procedure is complete. Local tags and package versions do not establish whether npm publication succeeded.

A release tag may be prepared locally while a push is on hold. In that case, verify that it points to the exact commit that passed CI before pushing it. Push `main` and the release tag separately: the branch push triggers CI and Pages, while the tag push triggers npm publication. Do not use `--follow-tags` or `--tags` for the branch push, because that could publish before the runtime matrix finishes.

Pushing `v*` runs `.github/workflows/publish.yml`, which checks the tag against `package.json`, runs `npm run release:check`, and publishes `dist/`. The root package is private. The workflow uses Node 22, npm 11.21.1 and npm trusted publishing with OIDC and provenance, without a token.

The renderer is versioned independently of pcbjs release trains. pcbjs's integration plan calls for a caret dependency once the required release is available; verify the consumer's actual dependency when coordinating a release.

## Package setup, only if missing

These are owner-only bootstrap instructions, not outstanding release tasks. Check the package and trusted-publisher binding before using them. Do not repeat a placeholder publication for an existing package.

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

`npm trust list @pcbjs/renderer` shows the binding. Confirm it targets `pcbjs/renderer` and `publish.yml` before the next release. Setup does not authorize publishing a release from this machine.
