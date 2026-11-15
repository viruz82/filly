import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-plugin'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      // Test-only key, never used anywhere else.
      miniflare: { bindings: { PUSH_KEY: 'test-push-key-0123456789abcdef0123456789' } },
    }),
  ],
})
