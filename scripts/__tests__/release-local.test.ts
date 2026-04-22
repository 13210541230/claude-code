import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import packageJson from '../../package.json'

const createdDirs: string[] = []
const RELEASE_LOCAL_TEST_TIMEOUT_MS = 20_000

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  createdDirs.push(dir)
  return dir
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function toMsysPath(windowsPath: string): string {
  const normalized = windowsPath.replace(/\\/g, '/')
  const match = normalized.match(/^([a-zA-Z]):\/(.*)$/)
  if (!match) return windowsPath
  return `/${match[1].toLowerCase()}/${match[2]}`
}

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('release-local script', () => {
  test('exposes a package script for local stable releases', () => {
    expect(packageJson.scripts['release-local']).toBe('bun run scripts/release-local.ts')
    expect(packageJson.scripts['release-local:global']).toBe(
      'bun run build && bun run release-local && bun run setup-myclaude-path',
    )
  })

  test('defaults to package.json version when --version is omitted', async () => {
    const workspaceDir = await createTempDir('release-local-default-version-workspace-')
    const distDir = join(workspaceDir, 'dist')
    await mkdir(join(distDir, 'vendor', 'audio-capture'), { recursive: true })
    await writeFile(join(distDir, 'cli-node.js'), '#!/usr/bin/env node\nimport "./cli.js"\n')
    await writeFile(join(distDir, 'cli.js'), 'console.log("hello")\n')
    await writeFile(join(distDir, 'vendor', 'audio-capture', 'marker.txt'), 'ok\n')

    const installRoot = await createTempDir('release-local-default-version-install-')
    const binDir = await createTempDir('release-local-default-version-bin-')

    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        join(process.cwd(), 'scripts', 'release-local.ts'),
        '--dist-dir',
        distDir,
        '--install-root',
        installRoot,
        '--bin-dir',
        binDir,
      ],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    })

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    expect(exitCode).toBe(0)
    expect(stderr).toMatch(/^$|^Skipped unresolved optional deps: \d+\r?\n?$/)
    expect(await readFile(join(installRoot, 'current.txt'), 'utf8')).toBe(`${packageJson.version}\n`)
  }, RELEASE_LOCAL_TEST_TIMEOUT_MS)

  test('publishes dist files into a versioned install dir and updates current.txt + wrapper', async () => {
    const workspaceDir = await createTempDir('release-local-workspace-')
    const distDir = join(workspaceDir, 'dist')
    await mkdir(join(distDir, 'vendor', 'audio-capture'), { recursive: true })
    await writeFile(join(distDir, 'cli-node.js'), '#!/usr/bin/env node\nimport "./cli.js"\n')
    await writeFile(join(distDir, 'cli.js'), 'console.log("hello")\n')
    await writeFile(join(distDir, 'vendor', 'audio-capture', 'marker.txt'), 'ok\n')

    const installRoot = await createTempDir('release-local-install-')
    const binDir = await createTempDir('release-local-bin-')
    const version = '9.9.9'

    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        join(process.cwd(), 'scripts', 'release-local.ts'),
        '--version',
        version,
        '--dist-dir',
        distDir,
        '--install-root',
        installRoot,
        '--bin-dir',
        binDir,
      ],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    })

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    const stdout = await new Response(proc.stdout).text()

    expect(exitCode).toBe(0)
    expect(stderr).toMatch(/^$|^Skipped unresolved optional deps: \d+\r?\n?$/)
    expect(stdout).toEqual(expect.stringContaining(version))

    const publishedCli = join(installRoot, 'versions', version, 'cli-node.js')
    const publishedChunk = join(installRoot, 'versions', version, 'cli.js')
    const publishedVendor = join(
      installRoot,
      'versions',
      version,
      'vendor',
      'audio-capture',
      'marker.txt',
    )
    const currentFile = join(installRoot, 'current.txt')
    const wrapperFile = join(binDir, 'myclaude.cmd')

    expect(await exists(publishedCli)).toBe(true)
    expect(await exists(publishedChunk)).toBe(true)
    expect(await exists(publishedVendor)).toBe(true)
    expect(await readFile(currentFile, 'utf8')).toBe(`${version}\n`)

    const wrapper = await readFile(wrapperFile, 'utf8')
    expect(wrapper).toContain('@echo off')
    expect(wrapper).toContain('current.txt')
    expect(wrapper).toContain('myclaude')
  }, RELEASE_LOCAL_TEST_TIMEOUT_MS)

  test('fails when required runtime dependency cannot be resolved', async () => {
    const workspaceDir = await createTempDir('release-local-missing-required-workspace-')
    const distDir = join(workspaceDir, 'dist')
    await mkdir(join(distDir, 'vendor', 'audio-capture'), { recursive: true })
    await writeFile(join(distDir, 'cli-node.js'), '#!/usr/bin/env node\nimport "./cli.js"\n')
    await writeFile(join(distDir, 'cli.js'), 'console.log("hello")\n')
    await writeFile(join(distDir, 'vendor', 'audio-capture', 'marker.txt'), 'ok\n')

    const installRoot = await createTempDir('release-local-missing-required-install-')
    const binDir = await createTempDir('release-local-missing-required-bin-')
    const missingDep = '@nonexistent/release-local-required-dep'

    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        join(process.cwd(), 'scripts', 'release-local.ts'),
        '--dist-dir',
        distDir,
        '--install-root',
        installRoot,
        '--bin-dir',
        binDir,
      ],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        MYCLAUDE_REQUIRED_RUNTIME_DEPS: missingDep,
      },
    })

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

    expect(exitCode).not.toBe(0)
    expect(stderr).toContain(`Required runtime deps unresolved: ${missingDep}`)
  }, RELEASE_LOCAL_TEST_TIMEOUT_MS)

  test('copies runtime dependency referenced from dist even if not in dependencies', async () => {
    const workspaceDir = await createTempDir('release-local-runtime-dist-dep-workspace-')
    const distDir = join(workspaceDir, 'dist')
    await mkdir(join(distDir, 'vendor', 'audio-capture'), { recursive: true })
    await writeFile(
      join(distDir, 'cli-node.js'),
      '#!/usr/bin/env node\nimport "./cli.js"\n',
    )
    await writeFile(
      join(distDir, 'cli.js'),
      'const hljs = require("highlight.js"); console.log(typeof hljs)\n',
    )
    await writeFile(join(distDir, 'vendor', 'audio-capture', 'marker.txt'), 'ok\n')

    const installRoot = await createTempDir('release-local-runtime-dist-dep-install-')
    const binDir = await createTempDir('release-local-runtime-dist-dep-bin-')

    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        join(process.cwd(), 'scripts', 'release-local.ts'),
        '--dist-dir',
        distDir,
        '--install-root',
        installRoot,
        '--bin-dir',
        binDir,
      ],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    })

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    expect(exitCode).toBe(0)
    expect(stderr).toMatch(/^$|^Skipped unresolved optional deps: \d+\r?\n?$/)

    const publishedHighlightDir = join(
      installRoot,
      'versions',
      packageJson.version,
      'node_modules',
      'highlight.js',
    )
    expect(await exists(publishedHighlightDir)).toBe(true)
  }, RELEASE_LOCAL_TEST_TIMEOUT_MS)

  test('supports Windows MSYS paths for input directories', async () => {
    if (process.platform !== 'win32') {
      expect(true).toBe(true)
      return
    }

    const workspaceDir = await createTempDir('release-local-msys-path-workspace-')
    const distDir = join(workspaceDir, 'dist')
    await mkdir(join(distDir, 'vendor', 'audio-capture'), { recursive: true })
    await writeFile(join(distDir, 'cli-node.js'), '#!/usr/bin/env node\nimport "./cli.js"\n')
    await writeFile(join(distDir, 'cli.js'), 'console.log("hello")\n')
    await writeFile(join(distDir, 'vendor', 'audio-capture', 'marker.txt'), 'ok\n')

    const installRoot = await createTempDir('release-local-msys-path-install-')
    const binDir = await createTempDir('release-local-msys-path-bin-')
    const version = '9.9.9-msys-path'

    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        join(process.cwd(), 'scripts', 'release-local.ts'),
        '--version',
        version,
        '--dist-dir',
        toMsysPath(distDir),
        '--install-root',
        toMsysPath(installRoot),
        '--bin-dir',
        toMsysPath(binDir),
      ],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    })

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    expect(exitCode).toBe(0)
    expect(stderr).toMatch(/^$|^Skipped unresolved optional deps: \d+\r?\n?$/)
    expect(await exists(join(installRoot, 'versions', version, 'cli-node.js'))).toBe(true)
    expect(await exists(join(binDir, 'myclaude.cmd'))).toBe(true)
  }, RELEASE_LOCAL_TEST_TIMEOUT_MS)
})
