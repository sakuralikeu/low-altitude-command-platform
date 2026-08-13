export function formatRecordTime(value: string): string {
  const match = value.match(/^\d{4}-(\d{2})-(\d{2})\s(\d{2}):(\d{2})/)
  return match ? `${match[1]}-${match[2]} ${match[3]}:${match[4]}` : '--'
}
