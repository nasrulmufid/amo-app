// `npm start` is the production full-stack entry point: Fastify serves API + web/dist.
// Force these values even if a parent process exports development overrides.
process.env.NODE_ENV = 'production'
process.env.SERVE_WEB = 'true'

await import('./dist/server.js')
