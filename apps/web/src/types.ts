export type Overview = {
  shelterNum: number; flyLineNum: number; achieveNum: number; flyerNum: number; workOrderNum: number
  recordCount: number; flyPlaneNum: number; flightLength: number; durationHours: number; generatedAt: string
}
export type FlightRecord = { id: string; name: string; routeName: string; executedAt: string; deviceName: string }
export type FlightTrackPoint = { longitude: number; latitude: number; altitudeM: number; speedMps: number; elapsedSeconds: number }
export type FlightReplay = {
  recordId: string; aircraftName: string; routeName: string; startedAt: string; durationSeconds: number
  mode: 'replay' | 'preview'; aircraftId?: string
  planned: FlightTrackPoint[]; actual: FlightTrackPoint[]; demo: boolean
}
export type FlightRoute = {
  id: string; name: string; orgName: string; aircraftId: string; aircraftName: string
  distanceKm: number; durationMinutes: number; altitudeM: number; status: 'active' | 'planned'; latestRecordId?: string
}
export type TaskStatus = 'dispatched' | 'dispatching' | 'received' | 'completed'
export type Period = 'today' | 'week' | 'month' | 'year' | 'all'
export type TaskRanking = {
  totals: Record<TaskStatus, number>
  rows: Array<{ id: string; name: string; total: number; value: number; percent: number }>
  generatedAt: string
}
export type FlightAnalytics = { id: string; name: string; recordCount: number; flightLength: number; durationHours: number }
export type Aircraft = {
  id: string; name: string; model: string; longitude: number; latitude: number; altitudeM: number; speedMps: number
  headingDeg: number; batteryPercent: number; status: 'flying' | 'standby' | 'warning'; task: string
}

/* ===== 场景模块类型（S2/S3/S4/S5/S7/S10） ===== */
export type NoFlyZone = {
  id: string; name: string; kind: 'airport' | 'temporary' | 'restricted'
  points: Array<[number, number]>; enabled: boolean; note?: string
}

export type ConflictPair = {
  a: Aircraft; b: Aircraft; horizontalM: number; verticalM: number; severity: 'watch' | 'critical'
}

export type DispatchCandidate = {
  aircraftId: string; name: string; model: string; status: string
  score: number; reasons: string[]; etaMinutes: number; batteryPercent: number; distanceM: number
}

export type WorkOrderStatus = 'pending' | 'received' | 'executing' | 'completed'
export type WorkOrderSource = 'plan' | 'alert' | 'dispatch' | 'maintenance'
export type WorkOrder = {
  id: string; title: string; lineName: string; orgName: string
  status: WorkOrderStatus; createdAt: string; dueAt: string; aircraftName?: string
  source?: WorkOrderSource; sourceAlertId?: string
}

export type AircraftHealth = {
  aircraftId: string; name: string; model: string; flightHours: number; totalFlights: number
  healthScore: number
  parts: Array<{ part: string; limit: number; used: number; remainingPercent: number; advice: string }>
}

export type AiRecognitionEvent = {
  id: string; kind: 'traffic' | 'smoke' | 'gathering' | 'parking'
  label: string; confidence: number; status: 'reviewing' | 'confirmed' | 'archived'
  aircraftName: string; occurredAt: string
  location: string; longitude: number; latitude: number; description: string
}

/** SSE 实时合规事件（S3/S4/S5） */
export type RealtimeAlertEvent =
  | ({ type: 'nofly'; zoneId: string; zoneName: string; aircraft: Aircraft } & AlertMeta)
  | ({ type: 'conflict'; a: Aircraft; b: Aircraft; horizontalM: number; verticalM: number; severity: 'watch' | 'critical' } & AlertMeta)
  | ({ type: 'low-battery'; aircraft: Aircraft; remainingMinutes: number; threshold: number } & AlertMeta)

type AlertMeta = { sequence?: number; generatedAt?: string }

export type DispatchTaskType = 'patrol' | 'inspect' | 'emergency'
