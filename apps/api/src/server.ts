import { createApp } from './app.js'
import { config } from './config.js'

const server = createApp().listen(config.PORT, '0.0.0.0', () => {
  console.log(`low-altitude-api listening on port ${config.PORT}`)
})

const shutdown = () => server.close(() => process.exit(0))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
