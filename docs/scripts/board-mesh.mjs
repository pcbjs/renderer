// Builds a glTF of a pcbjs example board from its compiled site data and the viewer's own meshes.
// Millimetres, z up, become metres, y up: (x, y, z) to (x / 1000, z / 1000, -y / 1000).
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { meshGlb } from '../../scripts/glb.mjs'

import { pcbjsRoot } from './model-paths.mjs'
const pcbjs = pcbjsRoot
const viewer = join(pcbjs, 'packages/viewer/src/')

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context)
      throw err
    }
  },
})

const stub = {
  font: '',
  fillStyle: '',
  textAlign: '',
  textBaseline: '',
  fillRect() {},
  clearRect() {},
  fillText() {},
  measureText() {
    return { width: 8 }
  },
}
globalThis.document = {
  createElement() {
    return { width: 16, height: 16, getContext: () => stub }
  },
}

const THREE = await import(pathToFileURL(join(pcbjs, 'node_modules/three/build/three.module.js')).href)
const { meshFromBinary } = await import(pathToFileURL(join(pcbjs, 'packages/step/dist/binary.js')).href)
const { stepMatrix } = await import(pathToFileURL(join(pcbjs, 'packages/step/dist/place.js')).href)
const { sideColors } = await import(pathToFileURL(join(viewer, 'stackup.ts')).href)
const { copperSlices, maskThickness } = await import(pathToFileURL(join(viewer, 'scene/stack.ts')).href)
const { dielectrics } = await import(pathToFileURL(join(viewer, 'scene/explode.ts')).href)
const { flatten, packDrills, runJob, toGeometry } = await import(pathToFileURL(join(viewer, 'scene/geometry.ts')).href)
const { inside } = await import(pathToFileURL(join(viewer, 'scene/shapes.ts')).href)
const { GeometryCache, buildItems, maskInfo } = await import(pathToFileURL(join(viewer, 'scene/items.ts')).href)
const { modelChoice } = await import(pathToFileURL(join(viewer, 'models/choice.ts')).href)
const { getModel } = await import(pathToFileURL(join(viewer, 'models/index.ts')).href)

const FINISH = { ENIG: '#d9b24c', HardGold: '#d9b24c', HASL: '#c9cccf', LeadFreeHASL: '#c9cccf', ImmersionSilver: '#d4d6d8', ImmersionTin: '#c4c6c8', OSP: '#c87533' }
const FR4 = '#a8955f'
const EDGE = '#b9a978'
const COPPER = '#c87533'

function std(color, roughness, metalness, side = THREE.FrontSide) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, side })
}

function maskCopper(hex) {
  const base = new THREE.Color(hex)
  const s = base.getHSL({ h: 0, s: 0, l: 0 }).s
  const bare = base.getRGB(new THREE.Color(), THREE.SRGBColorSpace)
  const cu = new THREE.Color(COPPER).getRGB(new THREE.Color(), THREE.SRGBColorSpace)
  const k = 0.08 + 0.16 * s
  return new THREE.Color().setRGB(bare.r + (cu.r - bare.r) * k, bare.g + (cu.g - bare.g) * k, bare.b + (cu.b - bare.b) * k, THREE.SRGBColorSpace).offsetHSL(0, 0, 0.03 + 0.03 * s)
}

function outlineOf(board) {
  if (board.outline.length) return board.outline
  const b = board.bbox
  return [
    [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ],
  ]
}

function npthRings(board) {
  const out = []
  for (const it of board.items ?? []) if (it.kind === 'pad' && it.drill && !it.layers.some(l => l.endsWith('.Cu')) && it.rings.length > 1) out.push(it.rings[1])
  return out
}

function slabMesh(board, depth, drills, openings, material) {
  const job = {
    kind: 'slab',
    key: 'slab',
    outline: flatten(outlineOf(board)),
    drills: packDrills(drills),
    ...(openings.length ? { openings: flatten(openings) } : {}),
    depth,
  }
  const geo = toGeometry(runJob(job))
  if (!geo) return null
  return new THREE.Mesh(geo, material)
}

function stepObject(fp, face, modelsDir) {
  let bin
  try {
    bin = readFileSync(join(modelsDir, `${fp.step.mesh}.bin`))
  } catch {
    return null
  }
  const g = new THREE.Group()
  g.matrixAutoUpdate = false
  g.matrix.fromArray(stepMatrix(fp, fp.step.transform, face))
  for (const q of meshFromBinary(bin).meshes) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(q.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(q.normals, 3))
    geo.setIndex(new THREE.BufferAttribute(q.indices, 1))
    const color = new THREE.Color().setRGB(q.color[0], q.color[1], q.color[2])
    const hsl = color.getHSL({ h: 0, s: 0, l: 0 })
    const metal = hsl.l > 0.25 && (hsl.s < 0.15 || (hsl.h > 0.08 && hsl.h < 0.17 && hsl.s > 0.3))
    g.add(new THREE.Mesh(geo, std(color, metal ? 0.35 : 0.6, metal ? 0.7 : 0.05)))
  }
  return g
}

function bodyObject(fp, face, modelsDir, thickness) {
  const placed = fp.step?.mesh ? stepObject(fp, face, modelsDir) : null
  if (placed) return placed
  const spec = modelChoice(fp)
  if (!spec) return null
  if (spec.kind === 'box') {
    const geo = new THREE.BoxGeometry(spec.w, spec.h, spec.height)
    geo.translate(0, 0, spec.height / 2)
    return new THREE.Mesh(geo, std('#8a8f98', 0.6, 0.05))
  }
  return getModel(spec, { value: fp.value, fields: fp.fields ?? {}, body: fp.body, height: fp.height, thickness })
}

function placeBody(fp, board, slices, modelsDir) {
  const back = fp.side === 'B'
  const face = back ? slices.get('B.Cu').z0 : slices.get('F.Cu').z1
  const model = bodyObject(fp, face, modelsDir, board.thickness)
  if (!model) return null
  if (fp.step?.mesh && model.matrixAutoUpdate === false) return model
  const wrap = new THREE.Group()
  const g = new THREE.Group()
  wrap.add(g)
  g.position.set(fp.body.x, -fp.body.y, face)
  g.rotation.z = (fp.body.rot * Math.PI) / 180
  if (back) {
    const flip = new THREE.Group()
    flip.rotation.y = Math.PI
    flip.add(model)
    g.add(flip)
  } else g.add(model)
  return wrap
}

function nodeName(object) {
  let p = object
  while (p) {
    if (p.name) return p.name
    p = p.parent
  }
  return 'board'
}

function take(buckets, name, mesh) {
  if (!mesh.isMesh || mesh.visible === false) return
  const pos = mesh.geometry?.getAttribute?.('position')
  const nor = mesh.geometry?.getAttribute?.('normal')
  if (!pos) return
  const index = mesh.geometry.getIndex()
  const groups = mesh.geometry.groups?.length ? mesh.geometry.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }]
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const world = mesh.matrixWorld
  const normal = new THREE.Matrix3().getNormalMatrix(world)
  const flip = world.determinant() < 0
  const v = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (const group of groups) {
    const mat = materials[group.materialIndex] ?? materials[0]
    if (!mat || mat.opacity < 0.5 || (mat.transparent && mat.map)) continue
    const hex = (mat.color ?? new THREE.Color('#888888')).getHexString()
    const metallic = mat.metalness ?? 0
    const roughness = mat.roughness ?? 1
    const doubleSided = mat.side === THREE.DoubleSide
    const key = `${name}|${hex}|${metallic}|${roughness}|${doubleSided}`
    let bucket = buckets.get(key)
    if (!bucket) {
      const rgb = Number.parseInt(hex, 16)
      buckets.set(
        key,
        (bucket = { name, color: [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, 1], metallic, roughness, doubleSided, positions: [], normals: [] }),
      )
    }
    const tris = Math.floor(group.count / 3)
    for (let t = 0; t < tris; t++) {
      const at = group.start + t * 3
      let i0 = index ? index.getX(at) : at
      let i1 = index ? index.getX(at + 1) : at + 1
      let i2 = index ? index.getX(at + 2) : at + 2
      if (flip) [i1, i2] = [i2, i1]
      for (const i of [i0, i1, i2]) {
        v.fromBufferAttribute(pos, i).applyMatrix4(world)
        if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(normal).normalize()
        else n.set(0, 0, 1)
        bucket.positions.push(v.x / 1000, v.z / 1000, -v.y / 1000)
        bucket.normals.push(n.x, n.z, -n.y)
      }
    }
  }
}

function weld(positions, normals) {
  const map = new Map()
  const pos = []
  const nor = []
  const idx = []
  for (let i = 0; i < positions.length; i += 3) {
    const key = `${Math.round(positions[i] * 1e6)},${Math.round(positions[i + 1] * 1e6)},${Math.round(positions[i + 2] * 1e6)},${Math.round(normals[i] * 200)},${Math.round(normals[i + 1] * 200)},${Math.round(normals[i + 2] * 200)}`
    let at = map.get(key)
    if (at === undefined) {
      at = pos.length / 3
      map.set(key, at)
      pos.push(positions[i], positions[i + 1], positions[i + 2])
      nor.push(normals[i], normals[i + 1], normals[i + 2])
    }
    idx.push(at)
  }
  const wide = pos.length / 3 > 65535
  const indices = wide ? new Uint32Array(idx) : new Uint16Array(idx)
  return { positions: pos, normals: nor, indices }
}

/** The board at `jsonPath`, with STEP meshes from `modelsDir`, as a GLB plus the frame the viewer orbits. */
export function boardGlb(jsonPath, modelsDir) {
  if (!existsSync(jsonPath)) throw new Error(`${jsonPath} is missing. Build that pcbjs example first.`)
  const board = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const slices = copperSlices(board)
  const maskT = { F: maskThickness(board, 'F'), B: maskThickness(board, 'B') }
  const mask = maskInfo(board, maskT)
  const finish = FINISH[board.stackup?.finish ?? ''] ?? FINISH.HASL
  const maskHex = side => sideColors(board.stackup, side).mask ?? '#1b5e20'
  const silkHex = side => sideColors(board.stackup, side).silk ?? '#f4f4f4'
  const materials = {
    outer: std(finish, 0.32, 0.75),
    inner: std(COPPER, 0.4, 0.6),
    silk: { F: std(silkHex('F'), 0.8, 0), B: std(silkHex('B'), 0.8, 0) },
    barrel: std(finish, 0.35, 0.7, THREE.DoubleSide),
    slab: [std(FR4, 0.7, 0), std(EDGE, 0.85, 0)],
    mask: {
      F: { bare: std(maskHex('F'), 0.55, 0), copper: std(maskCopper(maskHex('F')), 0.55, 0) },
      B: { bare: std(maskHex('B'), 0.55, 0), copper: std(maskCopper(maskHex('B')), 0.55, 0) },
    },
  }
  const root = new THREE.Group()
  const groups = new Map()
  const group = name => {
    let g = groups.get(name)
    if (!g) {
      g = new THREE.Group()
      g.name = name
      groups.set(name, g)
      root.add(g)
    }
    return g
  }
  const built = buildItems(
    board,
    slices,
    mask,
    {
      copper: layer => (layer === 'F.Cu' || layer === 'B.Cu' ? materials.outer : materials.inner),
      silk: side => materials.silk[side],
      barrel: materials.barrel,
      mask: side => materials.mask[side].copper,
    },
    new GeometryCache(),
    group,
  )
  built.fill(built.jobs.map(job => runJob(job)))
  for (const d of dielectrics(board, slices)) {
    const mesh = slabMesh(board, d.z1 - d.z0, board.drills, [], materials.slab)
    if (!mesh) continue
    mesh.position.z = d.z0
    group('board').add(mesh)
  }
  for (const side of ['F', 'B']) {
    const open = mask.openings[side].rings
    const holes = npthRings(board).filter(ring => {
      const xs = ring.map(p => p[0])
      const ys = ring.map(p => p[1])
      const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
      return !open.some(r => inside(c, r))
    })
    const t = maskT[side]
    const mesh = slabMesh(board, t, [], [...open, ...holes], materials.mask[side].bare)
    if (!mesh) continue
    mesh.position.z = side === 'F' ? slices.get('F.Cu').z0 : slices.get('B.Cu').z1 - t
    group(`${side}.Mask`).add(mesh)
  }
  for (const fp of board.footprints) {
    const body = placeBody(fp, board, slices, modelsDir)
    if (!body) continue
    body.name = `part:${fp.ref}`
    group(body.name).add(body)
  }
  root.updateMatrixWorld(true)
  const buckets = new Map()
  root.traverse(object => take(buckets, nodeName(object), object))
  let min = [Infinity, Infinity, Infinity]
  let max = [-Infinity, -Infinity, -Infinity]
  let triangles = 0
  const nodes = []
  for (const bucket of buckets.values()) {
    const n = bucket.positions.length / 3
    if (!n) continue
    triangles += n / 3
    for (let i = 0; i < bucket.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], bucket.positions[i + k])
        max[k] = Math.max(max[k], bucket.positions[i + k])
      }
    }
    nodes.push({
      name: bucket.name,
      color: bucket.color,
      metallic: bucket.metallic,
      roughness: bucket.roughness,
      ...(bucket.doubleSided ? { doubleSided: true } : {}),
      geometry: weld(bucket.positions, bucket.normals),
    })
  }
  const round = v => Math.round(v * 1e6) / 1e6
  const target = min.map((v, i) => round((v + max[i]) / 2))
  const span = round(Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]))
  return { glb: meshGlb(nodes), target, span, triangles, name: board.name }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [jsonPath, modelsDir] = process.argv.slice(2)
  const built = boardGlb(jsonPath, modelsDir ?? dirname(jsonPath))
  process.stdout.write(built.glb)
  console.error(`${built.name}  ${built.triangles} tris  span ${built.span.toFixed(4)}  target ${built.target.map(v => v.toFixed(4)).join(' ')}`)
}
