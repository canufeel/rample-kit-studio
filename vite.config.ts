import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Static SPA — no SSR, no backend. Builds to plain files for GitHub Pages / Tauri.
export default defineConfig({
  plugins: [react()],
  // Relative base so the build works from a project subpath (user.github.io/repo)
  // and from Tauri's file:// shell without reconfiguration.
  base: './',
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
})
