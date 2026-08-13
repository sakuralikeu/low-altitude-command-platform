export type ApiError = { error?: { code: string; message: string } }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('access_token')
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  const body = (await response.json()) as T & ApiError
  if (!response.ok) {
    if (response.status === 401 && !path.includes('/auth/')) {
      sessionStorage.clear()
      window.location.assign('/login')
    }
    throw new Error(body.error?.message || '服务暂时不可用')
  }
  return body
}
