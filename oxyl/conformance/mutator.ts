export interface ErrorBody {
  error: {
    type: string;
    code: string;
    message: string;
    param?: string;
    request_id: string;
  };
}

/** The document declares no error schemas, so the error type comes from here. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody | undefined,
  ) {
    super(body?.error.message ?? `Request failed with status ${status}`);
  }
}

export type ErrorType<_Error> = ApiError;
export type BodyType<BodyData> = BodyData;

const responseHeaders = new WeakMap<object, Headers>();

/**
 * The generated functions return the parsed body, so the response headers
 * (`ETag`) are kept beside it and read back with this.
 */
export const getResponseHeaders = (body: unknown): Headers | undefined =>
  typeof body === 'object' && body !== null
    ? responseHeaders.get(body)
    : undefined;

export const customFetch = async <T>(
  url: string,
  options: RequestInit,
): Promise<T> => {
  const headers = new Headers(options.headers);
  headers.set('Api-Version', '2026-01-01');

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, body as ErrorBody | undefined);
  }

  if (typeof body === 'object' && body !== null) {
    responseHeaders.set(body, response.headers);
  }

  return body as T;
};
