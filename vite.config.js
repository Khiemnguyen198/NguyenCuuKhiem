import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { sqliteApi } from './server/sqlite-api.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ command, mode }) => {
  const staticPages = process.env.VITE_STATIC_PAGES == null
    ? command === 'build' && mode !== 'desktop'
    : process.env.VITE_STATIC_PAGES === 'true';
  return {
    base: '/',
    define: { __APP_VERSION__: JSON.stringify(version), __STATIC_PAGES__: JSON.stringify(staticPages) },
    plugins: staticPages ? [] : [sqliteApi()],
    server: { host: '0.0.0.0', allowedHosts: ['terminal.local'] }
  };
});
