import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['opencv.js', 'icon.svg', 'ort/*'],
      workbox: {
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm}'],
        // Le moteur ONNX est servi depuis ort/ : la copie que Vite place dans assets/ ne sert pas.
        globIgnores: ['assets/ort-wasm*'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Déjà Vu',
        short_name: 'Déjà Vu',
        description: 'Est-ce que je l’ai déjà dans ma collection ?',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#15130f',
        theme_color: '#15130f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
