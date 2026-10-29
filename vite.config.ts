import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cloudflare Pages serves the built SPA with a fallback to index.html
// (see public/_redirects), so Vite's default history fallback matches
// production behavior in `vite preview` and local development.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
  },
  // Narrow typed environment access lives in src/config/env.ts.
  envPrefix: ['VITE_'],
});
