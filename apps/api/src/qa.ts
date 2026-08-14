/**
 * S9 数据智能问答（规则引擎 + LLM 增强演示版）
 *
 * 安全架构（回应材料对 S9 的四项风险）：
 * - 指标字典  → 本模块的聚合函数即"指标字典"，口径与排行榜/大屏一致
 * - 跨部门越权 → LLM 不接触原始数据，只拿到聚合后的统计 JSON
 * - SQL 沙箱  → LLM 永不生成 SQL，只能返回受限意图集 JSON（NLU 层）
 * - 幻觉兜底  → 回复基于给定数据生成 + 8s 超时降级 + 无 key 时纯规则
 *
 * 升级路径：LLM 不可用时自动降级纯规则；接口契约（QaAnswer）不变。
 */
import { aircraft, flightAnalytics, getShelters, getTaskRanking, overview, organizations } from './data.js'
import { getWorkOrders } from './scenarios.js'
import { config } from './config.js'

export type QaAnswer = {
  reply: string
  kind: 'text' | 'stats' | 'list'
  rows?: Array<{ label: string; value: string | number; percent?: number }>
  note?: string
}

type QaIntent = 'overview' | 'ranking' | 'aircraft' | 'low_battery' | 'alerts' | 'work_orders' | 'shelters' | 'compare' | 'greeting' | 'unknown'
type IntentMatch = { intent: QaIntent; orgs: string[]; period: 'today' | 'week' | 'month' | 'year' | 'all' }

/** 时间词 → 排行周期（默认本月，与排行榜口径一致） */
function pickPeriod(question: string): IntentMatch['period'] {
  if (question.includes('今日') || question.includes('今天')) return 'today'
  if (question.includes('本周') || question.includes('这周')) return 'week'
  if (question.includes('本年') || question.includes('今年') || question.includes('年度')) return 'year'
  if (question.includes('累计') || question.includes('全部') || question.includes('总共')) return 'all'
  return 'month'
}

function periodLabel(period: string): string {
  return { today: '今日', week: '本周', month: '本月', year: '本年', all: '累计' }[period] ?? '本月'
}

function fmt(value: number): string {
  return value.toLocaleString('zh-CN')
}

/* ================= 规则意图匹配（可解释、可审计） ================= */

function matchIntent(question: string): IntentMatch {
  const q = question
  const period = pickPeriod(q)
  if (/^(你好|您好|hi|hello|在吗|帮助|help)/i.test(q)) return { intent: 'greeting', orgs: [], period }

  const matched = organizations.filter((org) => q.includes(org.name))
  if (matched.length >= 2) return { intent: 'compare', orgs: matched.map((org) => org.name), period }

  if (q.includes('单位') || q.includes('组织') || q.includes('哪个') || q.includes('排名') || q.includes('最多')) return { intent: 'ranking', orgs: [], period }
  if (q.includes('电量') || q.includes('低电') || q.includes('返航')) return { intent: 'low_battery', orgs: [], period }
  if (q.includes('告警') || q.includes('预警') || q.includes('异常')) return { intent: 'alerts', orgs: [], period }
  if (q.includes('工单') || q.includes('任务单')) return { intent: 'work_orders', orgs: [], period }
  if (q.includes('方舱')) return { intent: 'shelters', orgs: [], period }
  if (q.includes('架次') || q.includes('里程') || q.includes('公里') || q.includes('时长') || q.includes('小时') || q.includes('航线') || q.includes('飞手') || q.includes('统计')) return { intent: 'overview', orgs: [], period }
  if (q.includes('飞机') || q.includes('无人机') || q.includes('几架') || q.includes('多少架')) return { intent: 'aircraft', orgs: [], period }
  return { intent: 'unknown', orgs: [], period }
}

/* ================= 意图执行（聚合真实内存数据） ================= */

function executeIntent(match: IntentMatch): QaAnswer {
  const { intent, orgs, period } = match
  const label = periodLabel(period)

  switch (intent) {
    case 'greeting':
      return {
        reply: '你好，我是数据问答助手（规则引擎 + DeepSeek 增强 · 演示数据）。可以问我：飞行架次/里程、单位任务排行、飞机状态、低电量、告警、工单、方舱统计，或对比两个单位（如"水务局和公安局谁飞得多"）。',
        kind: 'text',
      }
    case 'overview': {
      const rows = [
        { label: '飞行架次', value: fmt(overview.recordCount) },
        { label: '飞行里程', value: `${fmt(Math.round(overview.flightLength))} km` },
        { label: '飞行时长', value: `${overview.durationHours} h` },
        { label: '飞行航线', value: fmt(overview.flyLineNum) },
      ]
      return {
        reply: `${label}累计飞行 ${fmt(overview.recordCount)} 架次，里程 ${fmt(Math.round(overview.flightLength))} km，时长 ${overview.durationHours} 小时；现有 ${fmt(overview.flyLineNum)} 条航线、${fmt(overview.shelterNum)} 个方舱、${fmt(overview.flyerNum)} 名飞手。`,
        kind: 'stats',
        rows,
      }
    }
    case 'ranking': {
      const ranking = getTaskRanking(period, 'completed')
      const sorted = [...ranking.rows].sort((a, b) => b.total - a.total)
      const max = Math.max(1, sorted[0]?.total ?? 1)
      const top = sorted.slice(0, 5)
      const topText = top.map((row) => `${row.name}（${row.total} 项）`).join('、')
      return {
        reply: `${label}任务量排名（已结单口径）：${topText}。`,
        kind: 'stats',
        rows: top.map((row) => ({ label: row.name, value: `${row.total} 项`, percent: Math.round((row.total / max) * 100) })),
      }
    }
    case 'aircraft': {
      const flying = aircraft.filter((item) => item.status === 'flying' && !item.offline).length
      const standby = aircraft.filter((item) => item.status === 'standby' && !item.offline).length
      const warning = aircraft.filter((item) => item.status === 'warning' && !item.offline).length
      const offline = aircraft.filter((item) => item.offline).length
      return {
        reply: `当前共 ${aircraft.length} 架无人机：执行中 ${flying} 架、待命 ${standby} 架、告警 ${warning} 架、已下线 ${offline} 架。`,
        kind: 'stats',
        rows: [
          { label: '执行中', value: `${flying} 架`, percent: Math.round((flying / aircraft.length) * 100) },
          { label: '待命', value: `${standby} 架`, percent: Math.round((standby / aircraft.length) * 100) },
          { label: '告警', value: `${warning} 架`, percent: Math.round((warning / aircraft.length) * 100) },
          { label: '已下线', value: `${offline} 架`, percent: Math.round((offline / aircraft.length) * 100) },
        ],
      }
    }
    case 'low_battery': {
      const low = aircraft
        .filter((item) => item.batteryPercent <= 40 && !item.offline)
        .sort((a, b) => a.batteryPercent - b.batteryPercent)
      if (!low.length) return { reply: '当前没有电量低于 40% 的无人机，机队电量状况良好。', kind: 'text' }
      return {
        reply: `当前有 ${low.length} 架无人机电量偏低（≤40%）：${low.map((item) => `${item.name}（${item.batteryPercent}%）`).join('、')}。建议尽快安排返航或换机。`,
        kind: 'stats',
        rows: low.map((item) => ({ label: item.name, value: `${item.batteryPercent}%`, percent: item.batteryPercent })),
      }
    }
    case 'alerts': {
      const warning = aircraft.filter((item) => item.status === 'warning' && !item.offline)
      const alertRows = warning.map((item) => ({ label: item.name, value: `电量 ${item.batteryPercent}% · ${item.task}` }))
      return {
        reply: `当前有 ${warning.length} 架无人机处于告警状态（主要为低电量/应急待命）。告警可在首页"运行告警"抽屉查看并转工单。`,
        kind: 'list',
        rows: alertRows.length ? alertRows : [{ label: '运行告警', value: '当前无' }],
      }
    }
    case 'work_orders': {
      const totals = getWorkOrders().totals
      const pending = totals.pending ?? 0
      const received = totals.received ?? 0
      const executing = totals.executing ?? 0
      const completed = totals.completed ?? 0
      const total = pending + received + executing + completed
      return {
        reply: `当前共 ${total} 张工单：待接收 ${pending}、已接收 ${received}、执行中 ${executing}、已完结 ${completed}。`,
        kind: 'stats',
        rows: [
          { label: '待接收', value: `${pending} 张`, percent: total ? Math.round((pending / total) * 100) : 0 },
          { label: '已接收', value: `${received} 张`, percent: total ? Math.round((received / total) * 100) : 0 },
          { label: '执行中', value: `${executing} 张`, percent: total ? Math.round((executing / total) * 100) : 0 },
          { label: '已完结', value: `${completed} 张`, percent: total ? Math.round((completed / total) * 100) : 0 },
        ],
      }
    }
    case 'shelters': {
      const rows = getShelters()
      const enabled = rows.filter((item) => item.enabled)
      const fleet = rows.reduce((sum, item) => sum + item.aircraft.length, 0)
      return {
        reply: `共 ${rows.length} 个方舱：启用 ${enabled.length} 个、规划中 ${rows.length - enabled.length} 个，驻泊无人机合计 ${fleet} 架。`,
        kind: 'stats',
        rows: enabled.map((item) => ({ label: item.name, value: `${item.aircraft.length} 架`, percent: fleet ? Math.round((item.aircraft.length / fleet) * 100) : 0 })),
      }
    }
    case 'compare': {
      const stat = (name: string) => {
        const org = organizations.find((item) => item.name === name)
        return org ? flightAnalytics.find((item) => item.id === org.id) : undefined
      }
      const a = orgs[0] ?? ''
      const b = orgs[1] ?? ''
      const sa = stat(a)
      const sb = stat(b)
      if (!sa || !sb) return { reply: '无法对比：单位数据不存在。', kind: 'text' }
      const winner = sa.recordCount >= sb.recordCount ? a : b
      return {
        reply: `${a} 飞行 ${sa.recordCount} 架次（里程 ${sa.flightLength} km），${b} 飞行 ${sb.recordCount} 架次（里程 ${sb.flightLength} km）。${winner} 架次更多。`,
        kind: 'stats',
        rows: [
          { label: a, value: `${sa.recordCount} 架次`, percent: Math.round((sa.recordCount / Math.max(sa.recordCount, sb.recordCount)) * 100) },
          { label: b, value: `${sb.recordCount} 架次`, percent: Math.round((sb.recordCount / Math.max(sa.recordCount, sb.recordCount)) * 100) },
        ],
      }
    }
    default:
      return {
        reply: '这个问题我暂时不会（只覆盖演示口径，不生成虚构答案）。可以试试问：\n· 本月飞行了多少架次？\n· 哪个单位任务最多？\n· 现在有几架无人机在执行任务？\n· 有哪些飞机电量低？\n· 当前有多少张工单？\n· 水务局和公安局谁飞得多？',
        kind: 'text',
      }
  }
}

/** 纯规则入口（同步，LLM 不可用时/测试用） */
export function answerQuestion(question: string): QaAnswer {
  const q = question.trim()
  if (!q) return { reply: '请输入要查询的问题。', kind: 'text' }
  return executeIntent(matchIntent(q))
}

/* ================= LLM 增强层（DeepSeek，OpenAI 兼容） ================= */

const llmEnabled = Boolean(config.LLM_API_KEY)

async function llmChat(messages: Array<{ role: string; content: string }>, maxTokens = 300): Promise<string | null> {
  if (!llmEnabled) return null
  try {
    const response = await fetch(`${config.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.LLM_API_KEY}` },
      body: JSON.stringify({ model: config.LLM_MODEL, messages, temperature: 0.2, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content ?? null
  } catch { return null }
}

const INTENT_LIST = 'overview(架次/里程/时长统计)|ranking(单位任务排行)|aircraft(飞机状态)|low_battery(低电量)|alerts(告警)|work_orders(工单)|shelters(方舱)|compare(两单位对比)|greeting(问候)|unknown(无法识别)'

function parseIntentJson(raw: string | null): IntentMatch | null {
  if (!raw) return null
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as { intent?: string; orgs?: string[]; period?: string }
    const intents: QaIntent[] = ['overview', 'ranking', 'aircraft', 'low_battery', 'alerts', 'work_orders', 'shelters', 'compare', 'greeting', 'unknown']
    if (!parsed.intent || !intents.includes(parsed.intent as QaIntent)) return null
    const periods: IntentMatch['period'][] = ['today', 'week', 'month', 'year', 'all']
    const orgs = (parsed.orgs ?? []).filter((name) => organizations.some((org) => org.name === name)).slice(0, 2)
    return {
      intent: parsed.intent as QaIntent,
      orgs,
      period: periods.includes(parsed.period as IntentMatch['period']) ? parsed.period as IntentMatch['period'] : 'month',
    }
  } catch { return null }
}

/**
 * LLM 增强入口（异步）：
 * 1. 规则意图命中 → LLM 基于聚合数据润色回复（保留结构化 rows）
 * 2. 规则未命中 → LLM 意图解析 → 命中则按意图重查 + 润色；否则规则兜底引导
 * 3. LLM 不可用/超时/失败 → 自动降级纯规则
 */
export async function answerQuestionWithLLM(question: string): Promise<QaAnswer> {
  const q = question.trim()
  if (!q) return { reply: '请输入要查询的问题。', kind: 'text' }
  if (!llmEnabled) return answerQuestion(q)

  const ruleMatch = matchIntent(q)
  if (ruleMatch.intent !== 'unknown') {
    const base = executeIntent(ruleMatch)
    if (base.kind === 'text' && ruleMatch.intent === 'greeting') return base // 问候语规则版即可
    const polish = await llmChat([
      { role: 'system', content: '你是"无人机低空指挥调度平台"的数据问答助手。只依据给定系统数据回答，不得编造任何数字或事实；数字保留原样；回答不超过 60 字；简洁、专业、口语化自然。' },
      { role: 'user', content: `系统数据：${JSON.stringify({ reply: base.reply, rows: base.rows })}` },
      { role: 'user', content: `用户问题：${q}` },
    ])
    if (polish) return { ...base, reply: polish, note: 'DeepSeek 增强 · 数据为系统真实聚合' }
    return base
  }

  // 规则未命中：LLM 意图解析（受限意图集 + 单位名单，防幻觉）
  const intentRaw = await llmChat([
    { role: 'system', content: `你是查询意图解析器。从用户问题识别意图，仅输出 JSON（无其他文字）：{"intent":"<intent>","orgs":["单位名"],"period":"month"}。意图枚举：${INTENT_LIST}。可用单位：${organizations.map((org) => org.name).join('、')}。orgs 只在 compare 意图时填两个单位名（必须来自可用单位）；period 取值 today/week/month/year/all。无法识别输出 {"intent":"unknown"}。` },
    { role: 'user', content: `问题：${q}` },
  ], 150)
  const parsed = parseIntentJson(intentRaw)
  if (parsed && parsed.intent !== 'unknown') {
    const base = executeIntent(parsed)
    const polish = await llmChat([
      { role: 'system', content: '你是"无人机低空指挥调度平台"的数据问答助手。只依据给定系统数据回答，不得编造；数字保留原样；回答不超过 60 字；简洁专业。' },
      { role: 'user', content: `系统数据：${JSON.stringify({ reply: base.reply, rows: base.rows })}` },
      { role: 'user', content: `用户问题：${q}` },
    ])
    if (polish) return { ...base, reply: polish, note: 'DeepSeek 增强 · 数据为系统真实聚合' }
    return base
  }
  return executeIntent({ intent: 'unknown', orgs: [], period: 'month' })
}
