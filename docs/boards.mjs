function loadBoard(id) {
  let loading
  return function scene() {
    const base = import.meta.env.BASE_URL
    loading ??= Promise.all([fetch(`${base}models/${id}.glb`), fetch(`${base}models/${id}.json`)]).then(async ([model, frame]) => {
      if (!model.ok || !frame.ok) throw new Error(`${id} model is missing. The docs fetch step builds it from the pcbjs examples.`)
      const { target, span } = await frame.json()
      return { glb: new Uint8Array(await model.arrayBuffer()), target, span }
    })
    return loading
  }
}

export const blinkyScene = loadBoard('blinky')
export const psuScene = loadBoard('psu')
