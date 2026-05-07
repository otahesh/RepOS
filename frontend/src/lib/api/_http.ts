// Shared HTTP error class so callers can branch on status + parsed body
// instead of regex-matching the message. Extends Error so legacy code that
// reads `err.message` keeps working.

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, raw: string) {
    super(`HTTP ${status}: ${raw || ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const raw = await res.text();
    let parsed: unknown = undefined;
    try { parsed = raw ? JSON.parse(raw) : undefined; } catch { /* keep raw */ }
    throw new ApiError(res.status, parsed, raw || res.statusText);
  }
  return res.json() as Promise<T>;
}
