import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(8).default('change-me-before-deploy'),
  JWT_SECRET: z.string().min(32).default('local-development-secret-change-this'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
})

export const config = schema.parse(process.env)

if (config.NODE_ENV === 'production' && config.ADMIN_PASSWORD === 'change-me-before-deploy') {
  throw new Error('ADMIN_PASSWORD must be changed in production')
}
