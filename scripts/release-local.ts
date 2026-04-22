#!/usr/bin/env bun
import packageJson from '../package.json'
import { cp, mkdir, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { builtinModules, createRequire } from 'module'

const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function getRequiredArg(name: string): string {
  const value = getArg(name)
  if (!value) {
    console.error(`Missing required argument: ${name}`)
    process.exit(1)
  }
  return value
}

function normalizeWindowsMsysPath(inputPath: string): string {
  if (process.platform !== 'win32') return inputPath

  const msysDrivePath = inputPath.match(/^\/([a-zA-Z])(?:\/|$)(.*)$/)
  if (!msysDrivePath) return inputPath

  const drive = msysDrivePath[1].toUpperCase()
  const rest = msysDrivePath[2].replace(/\//g, '\\')
  if (!rest) return `${drive}:\\`
  return `${drive}:\\${rest}`
}

function resolveCliPath(inputPath: string): string {
  return resolve(normalizeWindowsMsysPath(inputPath))
}

function escapeForCmd(path: string): string {
  return path.replace(/"/g, '""')
}

async function ensureFileExists(path: string): Promise<void> {
  try {
    const info = await stat(path)
    if (!info.isFile()) {
      throw new Error(`${path} is not a file`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Required file missing: ${path} (${message})`)
  }
}

function toPackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return name ? `${scope}/${name}` : specifier
  }
  const [name] = specifier.split('/')
  return name
}

function isValidNpmPackageName(name: string): boolean {
  return /^(@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)
}

function collectExternalRuntimeDepsFromDist(distDir: string): string[] {
  if (!existsSync(distDir)) return []

  const packageNames = new Set<string>()
  const builtInModules = new Set(
    builtinModules.flatMap(moduleName =>
      moduleName.startsWith('node:')
        ? [moduleName, moduleName.slice('node:'.length)]
        : [moduleName, `node:${moduleName}`],
    ),
  )
  const jsFiles = readdirSync(distDir).filter(name => name.endsWith('.js'))

  for (const jsFile of jsFiles) {
    const filePath = join(distDir, jsFile)
    const content = readFileSync(filePath, 'utf8')

    const importFromRegex = /\bimport\s+(?:[^'";]+?\s+from\s+)?(["'])([^"']+)\1/g
    const exportFromRegex = /\bexport\s+[^'";]+?\s+from\s+(["'])([^"']+)\1/g
    const importCallRegex = /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g
    const requireRegex = /\brequire\s*\(\s*(["'])([^"']+)\1\s*\)/g

    for (const regex of [importFromRegex, exportFromRegex, importCallRegex, requireRegex]) {
      let match: RegExpExecArray | null
      while ((match = regex.exec(content)) !== null) {
        const specifier = match[2]
        if (
          !specifier ||
          specifier.startsWith('./') ||
          specifier.startsWith('../') ||
          specifier.startsWith('node:')
        ) {
          continue
        }

        const packageName = toPackageName(specifier)
        if (
          packageName &&
          isValidNpmPackageName(packageName) &&
          !builtInModules.has(specifier) &&
          !builtInModules.has(packageName)
        ) {
          packageNames.add(packageName)
        }
      }
    }
  }

  return Array.from(packageNames)
}

function resolvePackageDir(packageName: string): string {
  const pkgJsonPath = requireFromCwd.resolve(`${packageName}/package.json`)
  return dirname(pkgJsonPath)
}

function resolvePackageDirFromBunStore(packageName: string): string | null {
  const bunStoreDir = join(process.cwd(), 'node_modules', '.bun')
  if (!existsSync(bunStoreDir)) return null

  const encoded = packageName.replace('/', '+')
  const candidates = readdirSync(bunStoreDir)
    .filter(name => name.startsWith(`${encoded}@`))
    .sort()
    .reverse()

  for (const candidate of candidates) {
    const candidatePkgDir = join(
      bunStoreDir,
      candidate,
      'node_modules',
      packageName,
    )
    if (existsSync(join(candidatePkgDir, 'package.json'))) {
      return candidatePkgDir
    }
  }

  return null
}

function resolvePackageDirWithFallback(packageName: string): string {
  try {
    return resolvePackageDir(packageName)
  } catch {
    const bunStoreDir = resolvePackageDirFromBunStore(packageName)
    if (bunStoreDir) return bunStoreDir
    throw new Error(`Unable to resolve package: ${packageName}`)
  }
}

async function copyRuntimeDependencies(versionDir: string, distDir: string): Promise<number> {
  const requiredExtraDeps = (process.env.MYCLAUDE_REQUIRED_RUNTIME_DEPS ?? '')
    .split(',')
    .map(dep => dep.trim())
    .filter(Boolean)
  const requiredRuntimeDeps = Array.from(
    new Set([
      'sharp',
      ...Object.keys(packageJson.dependencies ?? {}),
      ...requiredExtraDeps,
    ]),
  )
  const optionalRuntimeDeps = collectExternalRuntimeDepsFromDist(distDir)
  const allRuntimeDeps = Array.from(new Set([...requiredRuntimeDeps, ...optionalRuntimeDeps]))
  if (allRuntimeDeps.length === 0) return 0

  const queue = [...allRuntimeDeps]
  const processed = new Set<string>()
  const requiredByDep = new Map<string, boolean>()
  for (const dep of requiredRuntimeDeps) {
    requiredByDep.set(dep, true)
  }
  for (const dep of optionalRuntimeDeps) {
    if (!requiredByDep.has(dep)) {
      requiredByDep.set(dep, false)
    }
  }
  const nodeModulesDir = join(versionDir, 'node_modules')
  await mkdir(nodeModulesDir, { recursive: true })

  let copied = 0
  const unresolvedOptional = new Set<string>()
  const unresolvedRequired = new Set<string>()

  function enqueueDep(depName: string, required: boolean): void {
    const prev = requiredByDep.get(depName)
    if (prev === undefined) {
      requiredByDep.set(depName, required)
      queue.push(depName)
      return
    }

    if (required && !prev) {
      requiredByDep.set(depName, true)
      if (processed.has(depName) && unresolvedOptional.delete(depName)) {
        unresolvedRequired.add(depName)
      }
    }
  }

  while (queue.length > 0) {
    const depName = queue.shift()!
    if (processed.has(depName)) continue
    processed.add(depName)
    const required = requiredByDep.get(depName) ?? false

    let sourceDir: string
    try {
      sourceDir = resolvePackageDirWithFallback(depName)
    } catch {
      if (required) {
        unresolvedRequired.add(depName)
      } else {
        unresolvedOptional.add(depName)
      }
      continue
    }
    const targetDir = join(nodeModulesDir, depName)

    await rm(targetDir, { recursive: true, force: true })
    await mkdir(dirname(targetDir), { recursive: true })
    await cp(sourceDir, targetDir, { recursive: true, dereference: true })
    copied++

    const depPkgJson = Bun.file(join(sourceDir, 'package.json'))
    const depPkg = (await depPkgJson.json()) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }

    for (const child of Object.keys(depPkg.dependencies ?? {})) {
      enqueueDep(child, true)
    }

    for (const child of Object.keys(depPkg.optionalDependencies ?? {})) {
      enqueueDep(child, false)
    }
  }

  if (unresolvedRequired.size > 0) {
    throw new Error(
      `Required runtime deps unresolved: ${Array.from(unresolvedRequired).sort().join(', ')}`,
    )
  }

  if (unresolvedOptional.size > 0) {
    console.warn(`Skipped unresolved optional deps: ${unresolvedOptional.size}`)
  }

  return copied
}

async function main(): Promise<void> {
  const version = getArg('--version') ?? packageJson.version
  const distDir = resolveCliPath(getArg('--dist-dir') ?? join(process.cwd(), 'dist'))
  const installRoot = resolveCliPath(
    getArg('--install-root') ?? join(process.env.USERPROFILE ?? process.cwd(), 'apps', 'myclaude'),
  )
  const binDir = resolveCliPath(
    getArg('--bin-dir') ?? join(process.env.USERPROFILE ?? process.cwd(), 'bin'),
  )

  await ensureFileExists(join(distDir, 'cli-node.js'))
  await ensureFileExists(join(distDir, 'cli.js'))

  const versionDir = join(installRoot, 'versions', version)
  const currentFile = join(installRoot, 'current.txt')
  const wrapperFile = join(binDir, 'myclaude.cmd')

  await rm(versionDir, { recursive: true, force: true })
  await mkdir(dirname(versionDir), { recursive: true })
  await cp(distDir, versionDir, { recursive: true })
  const copiedDeps = await copyRuntimeDependencies(versionDir, distDir)

  await writeFile(currentFile, `${version}\n`)

  const wrapper = [
    '@echo off',
    'setlocal',
    '',
    `set APP_HOME=${escapeForCmd(installRoot)}`,
    '',
    'for /f "usebackq delims=" %%i in ("%APP_HOME%\\current.txt") do set MYCLAUDE_VERSION=%%i',
    '',
    'if "%MYCLAUDE_VERSION%"=="" (',
    '  echo [myclaude] No current version set.',
    '  exit /b 1',
    ')',
    '',
    'node "%APP_HOME%\\versions\\%MYCLAUDE_VERSION%\\cli-node.js" %*',
    '',
  ].join('\r\n')

  await mkdir(binDir, { recursive: true })
  await writeFile(wrapperFile, wrapper)

  console.log(`Published myclaude ${version}`)
  console.log(`Install root: ${installRoot}`)
  console.log(`Wrapper: ${wrapperFile}`)
  console.log(`Runtime deps copied: ${copiedDeps}`)
}

await main()
