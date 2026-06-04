/**
 * Tiny, dependency-free fetch wrapper with retry + backoff.
 * Used by every upstream client (SAOS, CELLAR REST, CELLAR SPARQL).
 */

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  retries?: number;
  retryDelayMs?: number;
  /** Treat these HTTP codes as "give up immediately" — no retry. */
  giveUpOn?: number[];
  timeoutMs?: number;
}

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const text = await fetchText(url, {
    ...opts,
    headers: { Accept: "application/json", ...opts.headers },
  });
  return JSON.parse(text) as T;
}

export async function fetchText(url: string, opts: FetchJsonOptions = {}): Promise<string> {
  const retries = opts.retries ?? 4;
  const baseDelay = opts.retryDelayMs ?? 500;
  const giveUpOn = new Set(opts.giveUpOn ?? [400, 401, 403, 404, 410]);
  const timeoutMs = opts.timeoutMs ?? 30_000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "sententim/0.1.0 (+https://github.com/woladi/sententim)",
          ...opts.headers,
        },
        signal: ac.signal,
      });

      if (res.ok) return await res.text();

      if (giveUpOn.has(res.status)) {
        throw new HttpError(`HTTP ${res.status} ${res.statusText} on ${url}`, res.status);
      }
      lastError = new HttpError(`HTTP ${res.status} ${res.statusText} on ${url}`, res.status);
    } catch (err) {
      lastError = err;
      if (err instanceof HttpError && giveUpOn.has(err.status)) throw err;
    } finally {
      clearTimeout(t);
    }

    if (attempt < retries) {
      const delay = baseDelay * 2 ** attempt + Math.floor((attempt * 137) % 250);
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed after ${retries + 1} attempts: ${url}`);
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
