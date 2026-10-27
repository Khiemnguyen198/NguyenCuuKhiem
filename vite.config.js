import { defineConfig } from 'vite';
import { sqliteApi } from './server/sqlite-api.js';

export default defineConfig({
  base: '/',
  plugins: [sqliteApi()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local']
  }
});
