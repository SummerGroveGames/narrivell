import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

// Content security policy for the web version: only Narrivell's own files
// may run or load. (The Windows app gets its policy from tauri.conf.json.)
// When a feature needs an outside service (e.g. Google Drive), add that
// exact address to connect-src here – never a wildcard.
const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function webSecurityHeaders(): Plugin {
  return {
    name: 'narrivell-web-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: WEB_CSP }, injectTo: 'head-prepend' },
        { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
      ],
    },
  };
}

// Two builds from the same code:
// - Web (default): served from https://summergrovegames.github.io/narrivell/
//   The base path must match the repo name exactly (lowercase).
//   When the web version moves to its own domain, change it to '/'.
// - Desktop (`--mode desktop`, used by Tauri): files are served from the
//   app itself, so the base path is '/'.
export default defineConfig(({ mode }) => ({
  base: mode === 'desktop' ? '/' : '/narrivell/',
  plugins: [react(), ...(mode === 'desktop' ? [] : [webSecurityHeaders()])],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // No source maps in shipped builds.
    sourcemap: false,
  },
  server: {
    // Tauri expects the dev server on exactly this port.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
  },
}));
