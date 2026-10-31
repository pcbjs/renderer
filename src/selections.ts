/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { checkOptions, OptionError, type AssetInfo, type SelectionGeometry } from './options.js'

export function selectionGeometry(items: SelectionGeometry[] = [], info: AssetInfo) {
  if (!Array.isArray(items) || items.length > 65536) throw new OptionError('selectionGeometry', 'selection geometry must be an array with at most 65536 items')
  const ids = new Set<string>(),
    nodes = new Set(info.nodes.map(n => n.index))
  let bytes = 0
  return Array.from(items, (item, i) => {
    const path = `selectionGeometry[${i}]`
    checkOptions(path, item, ['id', 'node', 'positions', 'indices'])
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new OptionError(`${path}.id`, 'selection IDs must be nonempty and unique')
    ids.add(item.id)
    if (item.node !== undefined && !nodes.has(item.node)) throw new OptionError(`${path}.node`, 'selection anchor outside the selected scene', 'UNKNOWN_NODE')
    if (!(Array.isArray(item.positions) || item.positions instanceof Float32Array) || !item.positions.length || item.positions.length % 3)
      throw new OptionError(`${path}.positions`, 'positions must contain finite float32 XYZ triples')
    if (!(Array.isArray(item.indices) || item.indices instanceof Uint32Array) || !item.indices.length || item.indices.length % 3)
      throw new OptionError(`${path}.indices`, 'indices must contain valid triangle indices')
    bytes += 4 * (item.positions.length + item.indices.length)
    if (bytes > 64 * 1024 * 1024) throw new OptionError('selectionGeometry', 'selection geometry exceeds 64 MiB')
    for (const v of item.positions)
      if (typeof v !== 'number' || !Number.isFinite(Math.fround(v))) throw new OptionError(`${path}.positions`, 'positions must contain finite float32 XYZ triples')
    for (const v of item.indices)
      if (!Number.isInteger(v) || v < 0 || v >= item.positions.length / 3) throw new OptionError(`${path}.indices`, 'indices must contain valid triangle indices')
    return item
  })
}

export function selectionNodes(path: string, ids: string[], nodes: Map<string, number>) {
  if (!Array.isArray(ids)) throw new OptionError(path, `${path} must be an array of selection IDs`)
  return Array.from(ids, (id, i) => {
    if (typeof id !== 'string' || !nodes.has(id)) throw new OptionError(`${path}[${i}]`, `unknown selection ID: ${JSON.stringify(id)}`)
    return nodes.get(id)!
  })
}
