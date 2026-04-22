import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import packageJson from '../../package.json'

const createdDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  createdDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('add-myclaude-to-path script', () => {
  test('exposes a package script for PATH setup', () => {
    expect(packageJson.scripts['setup-myclaude-path']).toBe('bun run scripts/add-myclaude-to-path.ts')
  })

  test('adds bin dir to PATH file when missing', async () => {
    const homeDir = await createTempDir('myclaude-path-home-')
    const rcFile = join(homeDir, '.bashrc')
    await writeFile(rcFile, '# existing config\n')

    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        join(process.cwd(), 'scripts', 'add-myclaude-to-path.ts'),
        '--home-dir',
        homeDir,
        '--shell-rc',
        rcFile,
        '--bin-dir',
        'C:/Users/20557/bin',
      ],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    })

    expect(await proc.exited).toBe(0)
    expect(await new Response(proc.stderr).text()).toBe('')

    const rc = await readFile(rcFile, 'utf8')
    expect(rc).toContain('C:/Users/20557/bin')
    expect(rc).toContain('myclaude')
  })
})
