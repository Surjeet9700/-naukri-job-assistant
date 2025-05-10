import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  define: {
    'process.env': {}
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/background/background.ts'),
      output: {
        entryFileNames: 'background.js',
        format: 'iife',
        extend: true
      }
    }
  }
});