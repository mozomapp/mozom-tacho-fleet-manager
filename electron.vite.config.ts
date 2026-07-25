import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Bundle @mozomdev/tacho: its dist uses extensionless ESM imports that
    // Node's loader can't resolve when externalized.
    plugins: [externalizeDepsPlugin({ exclude: ['@mozomdev/tacho'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), tailwindcss()]
  }
})
