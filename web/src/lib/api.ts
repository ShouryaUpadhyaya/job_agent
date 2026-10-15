export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(path.startsWith("http") ? path : `${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return url.toString();
}

/**
 * fetch wrapper: JSON in/out, and non-2xx responses become ApiError with the server's
 * `error` message so components can show it instead of failing silently.
 */
export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {}
): Promise<T> {
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const res = await fetch(buildUrl(path, options.query), {
    method: options.method || (options.body ? "POST" : "GET"),
    headers: options.body && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? (isForm ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
    signal: options.signal,
  });

  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const serverError =
      data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "";
    const message = serverError || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
