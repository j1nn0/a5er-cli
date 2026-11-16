import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/index.js'

function readPackageJson(): Record<string, unknown> {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json is not a JSON object')
  }
  return parsed as Record<string, unknown>
}

describe('package manifest', () => {
  it('exports the version declared in package.json', () => {
    const pkg = readPackageJson()

    expect(pkg['version']).toBe(VERSION)
  })

  it('keeps the version semver-shaped', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('stays private so a publish cannot happen by accident', () => {
    const pkg = readPackageJson()

    expect(pkg['private']).toBe(true)
  })

  it('publishes under the expected name and bin', () => {
    const pkg = readPackageJson()

    expect(pkg['name']).toBe('@j1nn0/a5er-cli')
    expect(pkg['bin']).toEqual({ a5er: './dist/cli.js' })
  })

  it('declares the Node floor required by the runtime', () => {
    const pkg = readPackageJson()
    const engines = pkg['engines']

    expect(engines).toEqual({ node: '>=24' })
  })

  it('has no runtime dependencies', () => {
    const pkg = readPackageJson()

    expect(pkg['dependencies']).toBeUndefined()
  })
})
