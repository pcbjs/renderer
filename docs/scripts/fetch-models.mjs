import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pcbjsRoot } from './model-paths.mjs'

const out = fileURLToPath(new URL('../public/models/', import.meta.url))
const boards = [
  { id: 'blinky', project: 'examples/demo', name: 'Blinky' },
  { id: 'psu', project: 'examples/psu', name: 'PSU' },
]
const script = fileURLToPath(new URL('./board-mesh.mjs', import.meta.url))

const mtime = async file => {
  try {
    return (await stat(file)).mtimeMs
  } catch {
    return 0
  }
}

await mkdir(out, { recursive: true })
for (const board of boards) {
  const json = join(pcbjsRoot, board.project, '.pcbjs/dist/boards', `${board.name}.json`)
  const models = join(pcbjsRoot, board.project, '.pcbjs/models')
  const glbPath = join(out, `${board.id}.glb`)
  const metaPath = join(out, `${board.id}.json`)
  const source = await mtime(json)
  if (!source && (await mtime(glbPath)) && (await mtime(metaPath))) {
    console.log(`${board.id} kept`)
    continue
  }
  const src = Math.max(source, await mtime(script))
  if ((await mtime(glbPath)) >= src && (await mtime(metaPath)) >= src) {
    console.log(`${board.id} unchanged`)
    continue
  }
  const { boardGlb } = await import('./board-mesh.mjs')
  const built = boardGlb(json, models)
  await writeFile(glbPath, built.glb)
  await writeFile(metaPath, `${JSON.stringify({ target: built.target, span: built.span })}\n`)
  console.log(`${built.name}  ${built.triangles} tris  ${(built.glb.byteLength / 1e6).toFixed(1)} MB`)
}
