// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  trailingSlash: 'ignore',
  integrations: [react()],
  server: {
    port: 4322,
    host: '0.0.0.0',
  },
  vite: {
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
          configure: (proxy, _options) => {
            proxy.on('error', (_err, _req, res) => {
              if (!res.headersSent && typeof res.writeHead === 'function') {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Backend offline', code: 'ECONNREFUSED' }));
              }
            });
          },
        },
      },
    },
    optimizeDeps: {
      include: [
        'cbor-x',
        'tweetnacl',
        'jsqr',
        'qrcode',
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
      ],
    },
  },
});


