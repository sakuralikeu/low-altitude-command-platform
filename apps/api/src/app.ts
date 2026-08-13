import { randomInt, randomUUID } from 'node:crypto'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { z } from 'zod'
import { authenticate, requireRole, signAccessToken } from './auth.js'
import { config } from './config.js'
import { aircraft, createFlightRoute, filterFlightRoutes, flightAnalytics, flightRecords, flightRoutes, getFlightReplay, getFlightRoutePreview, getShelters, getTaskRanking, nextAircraftSnapshot } from './data.js'
import { overview } from './data.js'
import { noFlyZones } from './geo.js'
import {
  aiRecognitionEvents,
  applyDispatch,
  computeConflicts,
  detectRealtimeAlerts,
  createWorkOrder,
  generateWorkOrders,
  getAircraftHealth,
  getWorkOrders,
  recommendDispatch,
  setAircraftOffline,
  transitionAiEvent,
  transitionWorkOrder,
  type WorkOrderStatus,
} from './scenarios.js'

const captchaStore = new Map<string, { answer: string; expiresAt: number }>()
const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1), captchaId: z.string().uuid(), captcha: z.string().length(4) })
const rankingSchema = z.object({
  period: z.enum(['today', 'week', 'month', 'year', 'all']).default('month'),
  status: z.enum(['dispatched', 'dispatching', 'received', 'completed']).default('completed'),
})
const dispatchSchema = z.object({
  taskType: z.enum(['patrol', 'inspect', 'emergency']).default('inspect'),
  lng: z.coerce.number().min(121).max(122),
  lat: z.coerce.number().min(31).max(32),
  priority: z.enum(['normal', 'high']).default('normal'),
})
const dispatchTaskSchema = dispatchSchema.extend({ aircraftId: z.string().min(1).optional(), routeId: z.string().min(1).optional() })
const createRouteSchema = z.object({
  name: z.string().min(2).max(40),
  waypoints: z.array(z.tuple([z.coerce.number(), z.coerce.number()])).min(2).max(20),
  altitudeM: z.coerce.number().int().min(30).max(150).optional(),
})
const offlineSchema = z.object({ offline: z.boolean() })
const workOrderQuerySchema = z.object({ status: z.enum(['pending', 'received', 'executing', 'completed']).optional() })
const workOrderTransitionSchema = z.object({ to: z.enum(['received', 'executing', 'completed']) })
const generateSchema = z.object({ period: z.enum(['daily', 'weekly']) })
const createWorkOrderSchema = z.object({
  title: z.string().min(2).max(80),
  lineName: z.string().min(1).max(40).optional(),
  orgName: z.string().min(1).max(40).optional(),
  aircraftName: z.string().min(1).max(40).optional(),
  source: z.enum(['plan', 'alert', 'dispatch', 'maintenance']).default('plan'),
  sourceAlertId: z.string().min(1).max(80).optional(),
})
const aiEventTransitionSchema = z.object({ to: z.enum(['confirmed', 'archived']) })

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(cors({ origin: config.CORS_ORIGIN, credentials: false }))
  app.use(express.json({ limit: '64kb' }))
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id']?.toString() || randomUUID()
    res.setHeader('x-request-id', req.id)
    next()
  })

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'low-altitude-api', time: new Date().toISOString() }))

  app.get('/api/v1/auth/captcha', (_req, res) => {
    const id = randomUUID()
    const answer = String(randomInt(1000, 10000))
    captchaStore.set(id, { answer, expiresAt: Date.now() + 5 * 60_000 })
    res.setHeader('Cache-Control', 'no-store')
    res.json({ data: { id, challenge: answer, expiresInSeconds: 300 } })
  })

  app.post('/api/v1/auth/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '登录信息不完整' }, traceId: req.id })
    const challenge = captchaStore.get(parsed.data.captchaId)
    captchaStore.delete(parsed.data.captchaId)
    if (!challenge || challenge.expiresAt < Date.now() || challenge.answer !== parsed.data.captcha) {
      return res.status(401).json({ error: { code: 'CAPTCHA_INVALID', message: '验证码错误或已过期' }, traceId: req.id })
    }
    if (parsed.data.username !== config.ADMIN_USERNAME || parsed.data.password !== config.ADMIN_PASSWORD) {
      return res.status(401).json({ error: { code: 'CREDENTIALS_INVALID', message: '用户名或密码错误' }, traceId: req.id })
    }
    return res.json({ data: { accessToken: signAccessToken(), expiresInSeconds: 7200, user: { name: '指挥中心管理员', orgName: '市级指挥中心', roles: ['dashboard.viewer', 'operator', 'admin'] } } })
  })

  app.get('/api/v1/session', authenticate, (req, res) => res.json({ data: req.user }))
  app.get('/api/v1/dashboard/overview', authenticate, (_req, res) => res.json({ data: { ...overview, generatedAt: new Date().toISOString() } }))
  app.get('/api/v1/flight-records', authenticate, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50)
    res.json({ data: { total: flightRecords.length, rows: flightRecords.slice(0, limit), generatedAt: new Date().toISOString() } })
  })
  app.get('/api/v1/flight-records/:id/replay', authenticate, (req, res) => {
    const replay = getFlightReplay(String(req.params.id))
    if (!replay) return res.status(404).json({ error: { code: 'FLIGHT_RECORD_NOT_FOUND', message: '飞行记录不存在' }, traceId: req.id })
    res.json({ data: replay })
  })
  app.get('/api/v1/flight-routes', authenticate, (req, res) => {
    const rows = filterFlightRoutes(typeof req.query.q === 'string' ? req.query.q : '')
    res.json({ data: { total: rows.length, rows, generatedAt: new Date().toISOString() } })
  })
  app.post('/api/v1/flight-routes', authenticate, requireRole('operator', 'admin'), (req, res) => {
    const parsed = createRouteSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '航线信息不完整（名称 2-40 字、航点 2-20 个）' }, traceId: req.id })
    const route = createFlightRoute(parsed.data)
    if (!route) return res.status(400).json({ error: { code: 'ROUTE_INVALID', message: '航线创建失败：请检查名称与航点' }, traceId: req.id })
    res.status(201).json({ data: route })
  })
  app.get('/api/v1/flight-routes/:id/preview', authenticate, (req, res) => {
    const preview = getFlightRoutePreview(String(req.params.id))
    if (!preview) return res.status(404).json({ error: { code: 'FLIGHT_ROUTE_NOT_FOUND', message: '飞行航线不存在' }, traceId: req.id })
    res.json({ data: preview })
  })
  app.get('/api/v1/dashboard/task-ranking', authenticate, (req, res) => {
    const parsed = rankingSchema.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '筛选条件无效' }, traceId: req.id })
    res.json({ data: getTaskRanking(parsed.data.period, parsed.data.status) })
  })
  app.get('/api/v1/metrics/flights', authenticate, (_req, res) => res.json({ data: { rows: flightAnalytics, startDate: '2024-01-01', generatedAt: new Date().toISOString() } }))
  app.get('/api/v1/aircraft', authenticate, (_req, res) => res.json({ data: { rows: aircraft, generatedAt: new Date().toISOString() } }))

  /* ===== 方舱下钻（S1 扩展）：方舱 → 驻泊无人机 → 智能调度 ===== */
  app.get('/api/v1/shelters', authenticate, (_req, res) => res.json({ data: { rows: getShelters(), generatedAt: new Date().toISOString() } }))

  /* ===== 无人机下线/恢复（停用维护） ===== */
  app.post('/api/v1/aircraft/:id/offline', authenticate, requireRole('operator', 'admin'), (req, res) => {
    const parsed = offlineSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '下线参数无效' }, traceId: req.id })
    const item = setAircraftOffline(String(req.params.id), parsed.data.offline)
    if (!item) return res.status(404).json({ error: { code: 'AIRCRAFT_NOT_FOUND', message: '无人机不存在' }, traceId: req.id })
    res.json({ data: item })
  })

  /* ===== 场景模块 A/B/C：禁飞区 / 冲突 / 续航 ===== */
  app.get('/api/v1/geo/no-fly-zones', authenticate, (_req, res) => res.json({ data: { rows: noFlyZones, generatedAt: new Date().toISOString() } }))
  app.get('/api/v1/geo/conflicts', authenticate, (_req, res) => res.json({ data: { rows: computeConflicts(aircraft), generatedAt: new Date().toISOString() } }))

  /* ===== 场景模块 D：智能调度推荐（S2+S8） ===== */
  app.get('/api/v1/dispatch/candidates', authenticate, (req, res) => {
    const parsed = dispatchSchema.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '调度条件无效' }, traceId: req.id })
    const rows = recommendDispatch(parsed.data.taskType, parsed.data.lng, parsed.data.lat, parsed.data.priority)
    res.json({ data: { taskType: parsed.data.taskType, rows, generatedAt: new Date().toISOString() } })
  })
  app.post('/api/v1/dispatch/tasks', authenticate, requireRole('operator', 'admin'), (req, res) => {
    const parsed = dispatchTaskSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '派发条件无效' }, traceId: req.id })
    const candidates = recommendDispatch(parsed.data.taskType, parsed.data.lng, parsed.data.lat, parsed.data.priority)
    const target = parsed.data.aircraftId ? candidates.find((item) => item.aircraftId === parsed.data.aircraftId) ?? null : candidates[0] ?? null
    if (!target) return res.status(409).json({ error: { code: 'NO_CANDIDATE', message: '暂无可用无人机，请稍后重试' }, traceId: req.id })
    // 派发落地：飞机起飞、记录任务目标（SSE 快照将驱动其飞向目标），形成调度→飞行→工单闭环（S2/S8/S7）
    const taskLabel = parsed.data.taskType === 'emergency' ? '应急任务' : parsed.data.taskType === 'patrol' ? '巡逻任务' : '巡检任务'
    // 沿航线执行：航点序列入队，飞机依次飞经各航点；航线状态联动（active + 占用方）
    let routeName = taskLabel
    const route = parsed.data.routeId ? flightRoutes.find((item) => item.id === parsed.data.routeId) : undefined
    if (route) {
      if (!route.waypoints || route.waypoints.length < 2) {
        return res.status(409).json({ error: { code: 'ROUTE_NO_WAYPOINTS', message: '该航线未配置航点，无法沿航线执行' }, traceId: req.id })
      }
      applyDispatch(target.aircraftId, route.waypoints[0]![0], route.waypoints[0]![1], taskLabel, route.waypoints)
      route.status = 'active'
      route.usedByAircraftId = target.aircraftId
      routeName = route.name
    } else {
      applyDispatch(target.aircraftId, parsed.data.lng, parsed.data.lat, taskLabel)
    }
    const order = createWorkOrder({
      title: `${target.name} · ${taskLabel}${route ? `（${route.name}）` : ''}`,
      lineName: routeName,
      orgName: '市级指挥中心',
      aircraftName: target.name,
      source: 'dispatch',
    })
    return res.json({
      data: {
        taskId: order.id,
        aircraftId: target.aircraftId,
        aircraftName: target.name,
        etaMinutes: target.etaMinutes,
        message: `已派发 ${target.name} 执行${taskLabel}${route ? `，沿航线「${route.name}」飞行` : ''}（飞机已出动），预计 ${target.etaMinutes} 分钟到场，工单号 ${order.id}`,
        taskType: parsed.data.taskType,
        routeId: route?.id,
        dueAt: order.dueAt,
      },
      traceId: req.id,
    })
  })

  /* ===== 场景模块 E：巡检工单闭环（S7） ===== */
  app.get('/api/v1/work-orders', authenticate, (req, res) => {
    const parsed = workOrderQuerySchema.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '工单筛选条件无效' }, traceId: req.id })
    const data = getWorkOrders(parsed.data.status)
    res.json({ data: { ...data, generatedAt: new Date().toISOString() } })
  })
  app.post('/api/v1/work-orders/:id/transition', authenticate, requireRole('operator', 'admin'), (req, res) => {
    const parsed = workOrderTransitionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '流转目标无效' }, traceId: req.id })
    try {
      const order = transitionWorkOrder(String(req.params.id), parsed.data.to as WorkOrderStatus)
      res.json({ data: order })
    } catch (reason) {
      res.status(409).json({ error: { code: 'TRANSITION_INVALID', message: reason instanceof Error ? reason.message : '工单流转失败' }, traceId: req.id })
    }
  })
  app.post('/api/v1/work-orders/generate', authenticate, requireRole('operator', 'admin'), (req, res) => {
    const parsed = generateSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '生成周期无效' }, traceId: req.id })
    res.json({ data: generateWorkOrders(parsed.data.period) })
  })
  app.post('/api/v1/work-orders', authenticate, requireRole('operator', 'admin'), (req, res) => {
    const parsed = createWorkOrderSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '工单信息不完整' }, traceId: req.id })
    const order = createWorkOrder(parsed.data)
    res.status(201).json({ data: order })
  })

  /* ===== 场景模块 F：设备健康（S10） ===== */
  app.get('/api/v1/aircraft/health', authenticate, (_req, res) => res.json({ data: { rows: getAircraftHealth(), generatedAt: new Date().toISOString() } }))

  /* ===== 场景模块 G：AI 识别事件（演示，S6 处置闭环） ===== */
  app.get('/api/v1/events/ai-recognition', authenticate, (_req, res) => res.json({ data: { rows: aiRecognitionEvents, demo: true, generatedAt: new Date().toISOString() } }))
  app.post('/api/v1/events/ai-recognition/:id/transition', authenticate, requireRole('operator', 'admin'), (req, res) => {
    const parsed = aiEventTransitionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: '事件流转目标无效' }, traceId: req.id })
    try {
      const event = transitionAiEvent(String(req.params.id), parsed.data.to)
      res.json({ data: event })
    } catch (reason) {
      res.status(409).json({ error: { code: 'TRANSITION_INVALID', message: reason instanceof Error ? reason.message : '事件流转失败' }, traceId: req.id })
    }
  })

  /* ===== 实时遥测流（含合规事件：禁飞区 / 冲突 / 低电量） ===== */
  app.get('/api/v1/realtime/aircraft', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : ''
    req.headers.authorization = `Bearer ${token}`
    authenticate(req, res, () => {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders()
      let sequence = 0
      const zoneState = new Map<string, string>()
      const send = () => {
        const snapshot = nextAircraftSnapshot(sequence)
        res.write(`event: aircraft\ndata: ${JSON.stringify({ sequence, rows: snapshot, generatedAt: new Date().toISOString() })}\n\n`)
        for (const event of detectRealtimeAlerts(snapshot, zoneState)) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify({ sequence, ...event, generatedAt: new Date().toISOString() })}\n\n`)
        }
        sequence += 1
      }
      send()
      const interval = setInterval(send, 2000)
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000)
      req.on('close', () => { clearInterval(interval); clearInterval(heartbeat) })
    })
  })

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: '资源不存在' }, traceId: req.id }))
  return app
}
