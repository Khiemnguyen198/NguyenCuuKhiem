import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { sqliteApi } from './server/sqlite-api.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: '/',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [sqliteApi()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local']
  }
});
