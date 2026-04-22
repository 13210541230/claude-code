#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

async function main(): Promise<void> {
  const homeDir = resolve(getArg('--home-dir') ?? process.env.USERPROFILE ?? process.cwd())
  const rcFile = resolve(getArg('--shell-rc') ?? `${homeDir}/.bashrc`)
  const binDir = getArg('--bin-dir') ?? `${homeDir.replace(/\\/g, '/')}/bin`

  const current = await readTextOrEmpty(rcFile)
  if (current.includes(binDir)) {
    console.log(`PATH already contains ${binDir}`)
    return
  }

  const snippet = [
    '',
    '# myclaude',
    `export PATH="${binDir}:$PATH"`,
    '',
  ].join('\n')

  await mkdir(dirname(rcFile), { recursive: true })
  await writeFile(rcFile, `${current}${snippet}`)
  console.log(`Added ${binDir} to ${rcFile}`)
}

await main()
