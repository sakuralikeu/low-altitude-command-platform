import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

export type AuthUser = { sub: string; name: string; orgId: string; roles: string[] }

declare global {
  namespace Express {
    interface Request { id: string; user?: AuthUser }
  }
}

export function signAccessToken(): string {
  return jwt.sign({ name: '指挥中心管理员', orgId: '100', roles: ['dashboard.viewer', 'operator', 'admin'] }, config.JWT_SECRET, {
    subject: config.ADMIN_USERNAME,
    expiresIn: '2h',
    issuer: 'low-altitude-api',
    audience: 'low-altitude-web',
  })
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: '请先登录' }, traceId: req.id })
  try {
    req.user = jwt.verify(token, config.JWT_SECRET, { issuer: 'low-altitude-api', audience: 'low-altitude-web' }) as AuthUser
    next()
  } catch {
    return res.status(401).json({ error: { code: 'AUTH_INVALID', message: '登录状态已失效' }, traceId: req.id })
  }
}

/** 角色守卫：用于写操作（派发/工单流转/生成计划）等需要 operator/admin 的接口 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRoles = req.user?.roles ?? []
    if (!roles.some((role) => userRoles.includes(role))) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '无权执行此操作' }, traceId: req.id })
    }
    next()
  }
}
