import { describe, expect, it } from 'vitest'
import viteConfig from '../../vite.config.ts?raw'

// Live updates PR, criterion 16: during development the Vite dev server
// passes /socket.io (WebSocket upgrades included) on to the API, as it does
// for /api (docs/adr/0001).
describe('The dev server’s proxy', () => {
  // 16
  it('passes /socket.io on to the API, with WebSocket upgrades', () => {
    expect(viteConfig).toMatch(
      /['"]\/socket\.io['"]\s*:\s*\{[^}]*target:\s*['"]http:\/\/localhost:3000['"][^}]*ws:\s*true|['"]\/socket\.io['"]\s*:\s*\{[^}]*ws:\s*true[^}]*target:\s*['"]http:\/\/localhost:3000['"]/s,
    )
  })

  // 16
  it('still passes /api on to the API', () => {
    expect(viteConfig).toMatch(
      /['"]\/api['"]\s*:\s*['"]http:\/\/localhost:3000['"]|['"]\/api['"]\s*:\s*\{[^}]*target:\s*['"]http:\/\/localhost:3000['"]/s,
    )
  })
})
