/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { OptionError, type Renderer } from './options.js'

export type ErrorCode = 'ASSET_INVALID' | 'TEXTURE_LIMIT' | 'INITIALIZATION_FAILED' | 'RENDER_FAILED' | 'WASM_TRAP' | 'DISPOSED'
export class RendererError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly operation: string,
    message: string,
    readonly recoverable = code !== 'WASM_TRAP',
  ) {
    super(message)
    this.name = 'RendererError'
  }
}

export interface ErrorRecord {
  name: string
  message: string
  code: string
  operation?: string
  path?: string
  recoverable: boolean
}
export function serializeError(error: unknown): ErrorRecord {
  if (error instanceof OptionError) return { name: error.name, message: error.message, code: error.code, path: error.path, recoverable: true }
  if (error instanceof RendererError) return { name: error.name, message: error.message, code: error.code, operation: error.operation, recoverable: error.recoverable }
  return { name: 'Error', message: error instanceof Error ? error.message : String(error), code: 'UNKNOWN', recoverable: false }
}

export function failure(error: unknown, code: ErrorCode, operation: string): OptionError | RendererError {
  if (error instanceof OptionError || error instanceof RendererError) return error
  const trap = error instanceof WebAssembly.RuntimeError
  const message = error instanceof Error ? error.message : String(error)
  return new RendererError(trap ? 'WASM_TRAP' : message.startsWith('TEXTURE_LIMIT:') ? 'TEXTURE_LIMIT' : code, operation, message, !trap)
}

export function protectRenderer(renderer: Renderer, invalidate: () => void): Renderer {
  const failed = (error: unknown, operation: string): never => {
    const result = failure(error, 'RENDER_FAILED', operation)
    if (result instanceof RendererError && result.code === 'WASM_TRAP') invalidate()
    throw result
  }
  return new Proxy(renderer, {
    get(target, key, receiver) {
      const operation = String(key)
      try {
        const value = Reflect.get(target, key, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          try {
            const result = value.apply(target, args)
            return result instanceof Promise ? result.catch(error => failed(error, operation)) : result
          } catch (error) {
            return failed(error, operation)
          }
        }
      } catch (error) {
        return failed(error, operation)
      }
    },
  })
}
