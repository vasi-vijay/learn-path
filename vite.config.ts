import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig, Plugin } from 'vite';

function servePrecompressed(): Plugin {
  return {
    name: 'serve-precompressed',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url ? req.url.split('?')[0] : '';
        const acceptEncoding = (req.headers['accept-encoding'] as string) || '';

        if (rawUrl === '/vendor/bundle.js' || rawUrl === '/assets/index-3619C2Pg.js') {
          const jsPath = path.resolve('public/vendor/bundle.js');
          const gzPath = path.resolve('public/vendor/bundle.js.gz');
          if (acceptEncoding.includes('gzip') && fs.existsSync(gzPath)) {
            const gzStat = fs.statSync(gzPath);
            const jsStat = fs.existsSync(jsPath) ? fs.statSync(jsPath) : null;
            if (!jsStat || gzStat.mtimeMs >= jsStat.mtimeMs) {
              res.writeHead(200, {
                'Content-Type': 'text/javascript',
                'Content-Encoding': 'gzip',
                'Content-Length': gzStat.size,
                'Cache-Control': 'no-cache',
                'Vary': 'Accept-Encoding'
              });
              fs.createReadStream(gzPath).pipe(res);
              return;
            }
          }
          if (fs.existsSync(jsPath)) {
            const stat = fs.statSync(jsPath);
            res.writeHead(200, {
              'Content-Type': 'text/javascript',
              'Content-Length': stat.size,
              'Cache-Control': 'no-cache',
              'Vary': 'Accept-Encoding'
            });
            fs.createReadStream(jsPath).pipe(res);
            return;
          }
        }

        if (rawUrl === '/vendor/bundle.css' || rawUrl === '/assets/index-B3IHVqwm.css') {
          const cssPath = path.resolve('public/vendor/bundle.css');
          const gzPath = path.resolve('public/vendor/bundle.css.gz');
          if (acceptEncoding.includes('gzip') && fs.existsSync(gzPath)) {
            const gzStat = fs.statSync(gzPath);
            const cssStat = fs.existsSync(cssPath) ? fs.statSync(cssPath) : null;
            if (!cssStat || gzStat.mtimeMs >= cssStat.mtimeMs) {
              res.writeHead(200, {
                'Content-Type': 'text/css',
                'Content-Encoding': 'gzip',
                'Content-Length': gzStat.size,
                'Cache-Control': 'no-cache',
                'Vary': 'Accept-Encoding'
              });
              fs.createReadStream(gzPath).pipe(res);
              return;
            }
          }
          if (fs.existsSync(cssPath)) {
            const stat = fs.statSync(cssPath);
            res.writeHead(200, {
              'Content-Type': 'text/css',
              'Content-Length': stat.size,
              'Cache-Control': 'no-cache',
              'Vary': 'Accept-Encoding'
            });
            fs.createReadStream(cssPath).pipe(res);
            return;
          }
        }

        next();
      });
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [servePrecompressed(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
