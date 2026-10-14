import type { Event, State } from './types';

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000').replace(
  /\/$/,
  '',
);

export const urls = {
  stream: `${API_BASE}/api/stream`,
  camera: `${API_BASE}/api/camera/stream`,
  exportCsv: `${API_BASE}/api/export.csv`,
  frame: (eventId: number) => `${API_BASE}/api/events/${eventId}/frame.png`,
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { cache: 'no-store', ...init });
  } catch (cause) {
    throw new ApiError(`Network error for ${path}: ${String(cause)}`, null);
  }
  if (!response.ok) {
    throw new ApiError(`${path} answered ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  state: () => request<State>('/api/state'),
  events: (limit = 50) => request<Event[]>(`/api/events?limit=${limit}`),
  startNewRun: () => request<State>('/api/runs', { method: 'POST' }),
};
