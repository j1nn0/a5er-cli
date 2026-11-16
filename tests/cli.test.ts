import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/index.js'

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

interface CliResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run the built CLI in a child process with a fixed environment so the run is
 * deterministic and offline (no network, no inherited locale or timezone).
 */
function runCli(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      {
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, TZ: 'UTC', LANG: 'C', LC_ALL: 'C' },
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr })
          return
        }
        if (typeof error.code !== 'number') {
          reject(error)
          return
        }
        resolve({ code: error.code, stdout, stderr })
      },
    )
  })
}

describe('a5er cli', () => {
  it('prints help on stdout for --help and exits 0', async () => {
    const result = await runCli(['--help'])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('--version')
    expect(result.stdout).toContain('Phase 1')
    expect(result.stdout).toContain('NOT implemented')
  })

  it('prints the same help for -h', async () => {
    const long = await runCli(['--help'])
    const short = await runCli(['-h'])

    expect(short.code).toBe(0)
    expect(short.stdout).toBe(long.stdout)
  })

  it('prints the version on stdout for --version and exits 0', async () => {
    const result = await runCli(['--version'])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe(VERSION)
  })

  it('prints the version for -v', async () => {
    const result = await runCli(['-v'])

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe(VERSION)
  })

  it('prints help when invoked with no arguments', async () => {
    const result = await runCli([])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Usage:')
  })

  it('rejects an unknown option with exit 2 and usage on stderr', async () => {
    const result = await runCli(['--nope'])

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('unknown option "--nope"')
    expect(result.stderr).toContain('Usage:')
  })

  it('rejects an unknown option even when --help is present', async () => {
    const result = await runCli(['--help', '--nope'])

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--nope')
  })

  it('quotes untrusted arguments instead of interpolating them raw', async () => {
    const result = await runCli(['--bad\ncontrol'])

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('"--bad\\ncontrol"')
  })

  it('ships a shebang so the bin entry installs as an executable', () => {
    const source = readFileSync(CLI_PATH, 'utf8')

    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true)
  })
})
