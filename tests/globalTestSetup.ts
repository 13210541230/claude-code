import { afterEach } from 'bun:test'

const baseEnv = { ...process.env }
const baseCwd = process.cwd()

afterEach(() => {
  if (process.cwd() !== baseCwd) {
    try {
      process.chdir(baseCwd)
    } catch {}
  }

  for (const key of Object.keys(process.env)) {
    if (!(key in baseEnv)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})
