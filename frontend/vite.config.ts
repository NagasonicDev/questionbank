import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'

function requestLogging(): Plugin {
  return {
    name: 'questionbank-request-logging',
    configurePreviewServer(server) {
      const logFile = process.env.QB_SERVER_LOG || resolve(process.cwd(), '../logs/server.log')
      mkdirSync(dirname(logFile), { recursive: true })
      const write = (line: string) => {
        try {
          // Synchronous append keeps each completed request on disk immediately,
          // even when the launcher is stopped by closing its terminal.
          appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, 'utf8')
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[questionbank] Could not write request log: ${message}`)
        }
      }

      write(`INFO server started at http://localhost:${server.config.preview.port || 4173}`)
      server.middlewares.use((req, res, next) => {
        const started = Date.now()
        res.once('finish', () => {
          write(`${res.statusCode >= 500 ? 'ERROR' : 'INFO'} ${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`)
        })
        res.once('close', () => {
          if (!res.writableFinished) write(`WARN ${req.method} ${req.url} connection closed before response completed`)
        })
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/questionbank/',
  plugins: [react(), requestLogging()],
  build: {
    // The backend serves this build directly and already uses /assets/ for
    // uploaded question images/diagrams — rename Vite's own bundle output
    // directory so the two never collide.
    assetsDir: 'app-assets',
  },
})
