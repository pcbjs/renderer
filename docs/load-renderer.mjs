import init from '../build/pkg/renderer.js'

let ready

export function loadRenderer(url) {
  ready ??= init({ module_or_path: url }).then(
    () => undefined,
    err => {
      ready = undefined
      throw err
    },
  )
  return ready
}
