import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'

async function login(app: ReturnType<typeof createApp>): Promise<string> {
  const captcha = await request(app).get('/api/v1/auth/captcha')
  const { id, challenge } = captcha.body.data
  const login = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'change-me-before-deploy', captchaId: id, captcha: challenge })
  return login.body.data.accessToken as string
}

describe('health endpoint', () => {
  it('returns an operational status', async () => {
    const response = await request(createApp()).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
  })
})

describe('scenario modules', () => {
  let app: ReturnType<typeof createApp>
  let token: string

  beforeEach(async () => {
    app = createApp()
    token = await login(app)
  })

  it('requires authentication for scenario APIs', async () => {
    const response = await request(app).get('/api/v1/geo/no-fly-zones')
    expect(response.status).toBe(401)
  })

  it('returns deterministic planned and actual flight replay tracks', async () => {
    const response = await request(app).get('/api/v1/flight-records/1010/replay').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data.demo).toBe(true)
    expect(response.body.data.mode).toBe('replay')
    expect(response.body.data.planned.length).toBeGreaterThan(20)
    expect(response.body.data.actual.length).toBe(response.body.data.planned.length)
  })

  it('returns route catalog and planned-only preview tracks', async () => {
    const list = await request(app).get('/api/v1/flight-routes').set('Authorization', `Bearer ${token}`)
    expect(list.status).toBe(200)
    expect(list.body.data.total).toBe(list.body.data.rows.length)
    expect(list.body.data.rows.length).toBeGreaterThanOrEqual(8)
    const route = list.body.data.rows[0]
    const preview = await request(app).get(`/api/v1/flight-routes/${route.id}/preview`).set('Authorization', `Bearer ${token}`)
    expect(preview.status).toBe(200)
    expect(preview.body.data.mode).toBe('preview')
    expect(preview.body.data.aircraftId).toBe(route.aircraftId)
    expect(preview.body.data.planned.length).toBeGreaterThan(20)
    expect(preview.body.data.actual).toEqual([])
  })

  it('returns 404 for an unknown flight replay record', async () => {
    const response = await request(app).get('/api/v1/flight-records/missing/replay').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(404)
  })

  it('S5: returns no-fly zones with polygon points', async () => {
    const response = await request(app).get('/api/v1/geo/no-fly-zones').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    const rows = response.body.data.rows as Array<{ id: string; name: string; points: [number, number][] }>
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows[0]!.points.length).toBeGreaterThanOrEqual(3)
  })

  it('S3: returns current conflict pairs', async () => {
    const response = await request(app).get('/api/v1/geo/conflicts').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(Array.isArray(response.body.data.rows)).toBe(true)
  })

  it('S2: dispatch candidates are sorted with reasons and valid taskType filter', async () => {
    const response = await request(app).get('/api/v1/dispatch/candidates?taskType=emergency&lng=121.47&lat=31.22').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    const rows = response.body.data.rows as Array<{ aircraftId: string; score: number; reasons: string[] }>
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.score).toBeGreaterThanOrEqual(rows[rows.length - 1]!.score)
    expect(rows[0]!.reasons.length).toBeGreaterThan(0)
  })

  it('S2: rejects invalid dispatch coordinates', async () => {
    const response = await request(app).get('/api/v1/dispatch/candidates?taskType=patrol&lng=999&lat=31.22').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(400)
  })

  it('S2: dispatch task creates a work order and returns ETA', async () => {
    const response = await request(app).post('/api/v1/dispatch/tasks').set('Authorization', `Bearer ${token}`).send({ taskType: 'patrol', lng: 121.47, lat: 31.22 })
    expect(response.status).toBe(200)
    expect(response.body.data.taskId).toMatch(/^WO-/)
    expect(response.body.data.etaMinutes).toBeGreaterThan(0)
  })

  it('S7: work orders list with totals', async () => {
    const response = await request(app).get('/api/v1/work-orders').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    const data = response.body.data
    expect(data.rows.length).toBeGreaterThan(10)
    expect(data.totals).toHaveProperty('pending')
    expect(data.totals).toHaveProperty('completed')
  })

  it('S7: work order state machine enforces valid transitions', async () => {
    const list = await request(app).get('/api/v1/work-orders').set('Authorization', `Bearer ${token}`)
    const pending = (list.body.data.rows as Array<{ id: string; status: string }>).find((row) => row.status === 'pending')!
    const ok = await request(app).post(`/api/v1/work-orders/${pending.id}/transition`).set('Authorization', `Bearer ${token}`).send({ to: 'received' })
    expect(ok.status).toBe(200)
    expect(ok.body.data.status).toBe('received')
    const invalid = await request(app).post(`/api/v1/work-orders/${pending.id}/transition`).set('Authorization', `Bearer ${token}`).send({ to: 'completed' })
    expect(invalid.status).toBe(409)
  })

  it('S7: generate daily work orders', async () => {
    const response = await request(app).post('/api/v1/work-orders/generate').set('Authorization', `Bearer ${token}`).send({ period: 'daily' })
    expect(response.status).toBe(200)
    expect(response.body.data.generated).toBeGreaterThanOrEqual(0)
    expect(response.body.data.skipped).toBeGreaterThanOrEqual(0)
    expect(response.body.data.message.length).toBeGreaterThan(0)
  })

  it('S10: aircraft health with parts advice', async () => {
    const response = await request(app).get('/api/v1/aircraft/health').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    const rows = response.body.data.rows as Array<{ aircraftId: string; healthScore: number; parts: Array<{ part: string; advice: string }> }>
    expect(rows.length).toBe(10)
    expect(rows[0]!.parts.length).toBe(3)
    expect(rows[0]!.parts[0]!.advice.length).toBeGreaterThan(0)
  })

  it('S6: AI recognition events marked as demo', async () => {
    const response = await request(app).get('/api/v1/events/ai-recognition').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data.demo).toBe(true)
    expect(response.body.data.rows.length).toBeGreaterThan(5)
  })

  it('S6: AI event confirmation persists through the state machine', async () => {
    const list = await request(app).get('/api/v1/events/ai-recognition').set('Authorization', `Bearer ${token}`)
    const reviewing = (list.body.data.rows as Array<{ id: string; status: string }>).find((row) => row.status === 'reviewing')!
    const confirmed = await request(app).post(`/api/v1/events/ai-recognition/${reviewing.id}/transition`).set('Authorization', `Bearer ${token}`).send({ to: 'confirmed' })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.data.status).toBe('confirmed')
    const invalid = await request(app).post(`/api/v1/events/ai-recognition/${reviewing.id}/transition`).set('Authorization', `Bearer ${token}`).send({ to: 'confirmed' })
    expect(invalid.status).toBe(409)
  })

  it('S7: creating an alert-sourced work order returns pending ticket', async () => {
    const response = await request(app).post('/api/v1/work-orders').set('Authorization', `Bearer ${token}`).send({
      title: '禁飞区违规处置 · 海巡-01',
      lineName: '应急处置航线',
      orgName: '市级指挥中心',
      aircraftName: '海巡-01',
      source: 'alert',
      sourceAlertId: 'nofly-UAV-01',
    })
    expect(response.status).toBe(201)
    expect(response.body.data.status).toBe('pending')
    expect(response.body.data.source).toBe('alert')
    expect(response.body.data.id).toMatch(/^WO-/)
  })

  it('S2/S8 闭环：派发后飞机起飞、任务更新、不再出现在候选（防重复派发）', async () => {
    const list = await request(app).get('/api/v1/aircraft').set('Authorization', `Bearer ${token}`)
    const standby = (list.body.data.rows as Array<{ id: string; name: string; status: string }>).find((row) => row.status === 'standby')
    expect(standby).toBeTruthy()

    const dispatch = await request(app).post('/api/v1/dispatch/tasks').set('Authorization', `Bearer ${token}`).send({ taskType: 'inspect', lng: 121.47, lat: 31.22, aircraftId: standby!.id })
    expect(dispatch.status).toBe(200)
    expect(dispatch.body.data.message).toContain('飞机已出动')

    // 飞机状态联动：standby → flying，任务文本更新
    const after = await request(app).get('/api/v1/aircraft').set('Authorization', `Bearer ${token}`)
    const plane = (after.body.data.rows as Array<{ id: string; status: string; task: string }>).find((row) => row.id === standby!.id)!
    expect(plane.status).toBe('flying')
    expect(plane.task).toBe('巡检任务')

    // 防重复：已有未完结工单的飞机不再进入候选
    const candidates = await request(app).get('/api/v1/dispatch/candidates?taskType=inspect&lng=121.47&lat=31.22').set('Authorization', `Bearer ${token}`)
    const ids = (candidates.body.data.rows as Array<{ aircraftId: string }>).map((row) => row.aircraftId)
    expect(ids).not.toContain(standby!.id)
  })

  it('S7 闭环：工单流转联动飞机状态（执行中=起飞，结案=释放回待命）', async () => {
    const list = await request(app).get('/api/v1/aircraft').set('Authorization', `Bearer ${token}`)
    const standby = (list.body.data.rows as Array<{ id: string; name: string; status: string }>).find((row) => row.status === 'standby')
    expect(standby).toBeTruthy()

    const created = await request(app).post('/api/v1/work-orders').set('Authorization', `Bearer ${token}`).send({
      title: '闭环联动测试任务', lineName: '测试航线', orgName: '市级指挥中心', aircraftName: standby!.name, source: 'plan',
    })
    const orderId = created.body.data.id as string
    await request(app).post(`/api/v1/work-orders/${orderId}/transition`).set('Authorization', `Bearer ${token}`).send({ to: 'received' })
    await request(app).post(`/api/v1/work-orders/${orderId}/transition`).set('Authorization', `Bearer ${token}`).send({ to: 'executing' })

    const executing = await request(app).get('/api/v1/aircraft').set('Authorization', `Bearer ${token}`)
    const plane = (executing.body.data.rows as Array<{ id: string; status: string; task: string }>).find((row) => row.id === standby!.id)!
    expect(plane.status).toBe('flying')
    expect(plane.task).toBe('闭环联动测试任务')

    await request(app).post(`/api/v1/work-orders/${orderId}/transition`).set('Authorization', `Bearer ${token}`).send({ to: 'completed' })
    const released = await request(app).get('/api/v1/aircraft').set('Authorization', `Bearer ${token}`)
    const releasedPlane = (released.body.data.rows as Array<{ id: string; status: string; task: string }>).find((row) => row.id === standby!.id)!
    expect(releasedPlane.status).toBe('standby')
    expect(releasedPlane.task).toBe('待命')
  })
})
