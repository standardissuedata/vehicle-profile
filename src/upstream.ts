export type Row = Record<string, unknown>;
export type GetJson = (url: URL) => Promise<Row>;

export function endpoint(base: string, path: string, params?: Record<string, string>): URL {
  const url = new URL(path, base);
  if (params) url.search = new URLSearchParams(params).toString();
  return url;
}

export function asObject(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object from the upstream source.');
  }
  return value as Row;
}

export function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error('Expected a list from the upstream source.');
  return value.map(asObject);
}

export function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && !/^(not applicable|not reported)$/i.test(value.trim())
    ? value.trim() : null;
}

export function number(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function createGetter(
  fetcher: typeof fetch,
  timeoutMs: number,
  signal?: AbortSignal,
): GetJson {
  return async (url) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    if (!response.ok && !(response.status === 400 && url.hostname === 'api.nhtsa.gov')) {
      throw new Error(`Upstream HTTP ${response.status}`);
    }
    const body = asObject(await response.json());
    if (!response.ok && !(Array.isArray(body.results) && body.results.length === 0
        && (body.Count === 0 || body.count === 0))) {
      throw new Error(`Upstream HTTP ${response.status}`);
    }
    return body;
  };
}

export type LookupStatus = 'ok' | 'ambiguous' | 'no_records' | 'unavailable' | 'missing_identity';

export interface Section<T> {
  source: string;
  url: string;
  scope: 'year_make_model' | 'configuration';
  status: LookupStatus;
  records: T[];
}

export function section<T>(
  source: string,
  url: URL,
  scope: Section<T>['scope'],
  read: ((url: URL) => Promise<T[]>) | null,
): Promise<Section<T>> {
  const base = {source, url: url.href, scope};
  if (!read) return Promise.resolve({...base, status: 'missing_identity', records: []});
  return read(url).then(records => ({
    ...base,
    status: records.length === 0 ? 'no_records' : scope === 'configuration' && records.length > 1 ? 'ambiguous' : 'ok',
    records,
  }), () => ({...base, status: 'unavailable', records: []}));
}

export async function inBatches<T, U>(values: T[], run: (value: T) => Promise<U>): Promise<U[]> {
  const result: U[] = [];
  for (let index = 0; index < values.length; index += 3) {
    result.push(...await Promise.all(values.slice(index, index + 3).map(run)));
  }
  return result;
}
