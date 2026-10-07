import { defineConfig, type Plugin } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

// KaTeX needs its math fonts; modern browsers only need the WOFF2 versions.
// Remove legacy fallback URLs before Vite discovers and emits font assets.
function modernMathFonts(): Plugin {
  return {
    name: 'modern-math-fonts',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/katex/dist/katex.min.css')) return
      return code.replace(/,\s*url\([^)]*\)\s*format\(["'](?:woff|truetype)["']\)/g, '')
    },
  }
}

export default defineConfig({
  plugins: [
    {
      name: 'cache-built-assets',
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          // Vite fingerprints built assets; HTML must still check for updates.
          res.setHeader('Cache-Control', req.url?.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable' : 'no-cache');
          next();
        });
      },
    },
    figmaAssetResolver(),
    modernMathFonts(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    warmup: { clientFiles: ['./src/app/pages/LoginPage.tsx', './src/app/pages/ChatPage.tsx'] },
    // Without this, Vite can end up bound only to the IPv6 loopback
    // ([::1]), which some browsers/networks can't reach at
    // http://127.0.0.1 or even http://localhost. Binding to all
    // interfaces makes both IPv4 and IPv6 localhost work reliably.
    host: true,
    // Vite 6 rejects any request whose Host header isn't localhost/an
    // allowed host (DNS-rebinding protection) — that's the 403 you get
    // when hitting the dev server through an ngrok tunnel. Allow ngrok's
    // domains (leading "." = match the domain and all its subdomains, so
    // this survives ngrok handing out a new random subdomain each run).
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io", ".ngrok.app"],
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
