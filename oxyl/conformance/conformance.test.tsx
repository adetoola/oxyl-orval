import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import * as gadgets from './generated/gadgets/gadgets';
import type {
  ArchiveWidgetHeaders,
  CreateWidgetHeaders,
  Widget,
  WidgetResponse,
} from './generated/model';
import * as sprockets from './generated/sprockets/sprockets';
import * as status from './generated/status/status';
import {
  getRetrieveWidgetQueryKey,
  retrieveWidget,
  useArchiveWidget,
  useCreateWidget,
  useListWidgetsInfinite,
  useRenameWidget,
} from './generated/widgets/widgets';
import {
  getListWidgetsMockHandler,
  getListWidgetsResponseMock,
} from './generated/widgets/widgets.msw';
import { ApiError, getResponseHeaders } from './mutator';

const meta = { request: { id: 'req_1' } };

const widget = (id: string): Widget => ({
  id,
  object: 'widget',
  displayName: `Widget ${id}`,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
});

const widgetResponse = (id: string): WidgetResponse => ({
  data: widget(id),
  meta,
});

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const wrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

const cursorOf = (request: Request) =>
  new URL(request.url).searchParams.get('startingAfter');

describe('1. lists page without caller-supplied paging options', () => {
  it('follows the cursor in the body and stops when the flag is false', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get('*/api/widgets', ({ request }) => {
        const cursor = cursorOf(request);
        cursors.push(cursor);
        return HttpResponse.json(
          cursor === null
            ? {
                object: 'list',
                data: [widget('wid_1')],
                hasMore: true,
                nextCursor: 'cur_1',
                meta,
              }
            : {
                object: 'list',
                data: [widget('wid_2')],
                hasMore: false,
                nextCursor: null,
                meta,
              },
        );
      }),
    );

    const { result } = renderHook(() => useListWidgetsInfinite(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(() => result.current.fetchNextPage());

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(cursors).toEqual([null, 'cur_1']);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('pages after the last item when the body has no paging fields', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get('*/api/gadgets', ({ request }) => {
        const cursor = cursorOf(request);
        cursors.push(cursor);
        return HttpResponse.json({
          object: 'list',
          data:
            cursor === null
              ? [
                  { id: 'gad_1', object: 'gadget' },
                  { id: 'gad_2', object: 'gadget' },
                ]
              : [],
          meta,
        });
      }),
    );

    const { result } = renderHook(() => gadgets.useListGadgetsInfinite(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(() => result.current.fetchNextPage());

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(cursors).toEqual([null, 'gad_2']);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('pages after the last item and stops on the flag when only the flag is declared', async () => {
    server.use(
      http.get('*/api/sprockets', () =>
        HttpResponse.json({
          object: 'list',
          data: [{ id: 'spr_1', object: 'sprocket' }],
          hasMore: false,
          meta,
        }),
      ),
    );

    const { result } = renderHook(() => sprockets.useListSprocketsInfinite(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('lets the caller replace the generated paging', async () => {
    server.use(
      http.get('*/api/widgets', () =>
        HttpResponse.json({
          object: 'list',
          data: [],
          hasMore: true,
          nextCursor: 'cur_1',
          meta,
        }),
      ),
    );

    const { result } = renderHook(
      () =>
        useListWidgetsInfinite(undefined, {
          query: { getNextPageParam: () => undefined },
        }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('generates no infinite hook for an operation that is not paginated', () => {
    expect(Object.keys(status)).not.toContain('useRetrieveStatusInfinite');
  });
});

describe('2. idempotent mutations', () => {
  const recordKeys = (failFirst = false) => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('*/api/widgets', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return failFirst && keys.length === 1
          ? HttpResponse.error()
          : HttpResponse.json(widgetResponse('wid_1'), { status: 201 });
      }),
    );
    return keys;
  };

  it('creates a key when the caller passes none', async () => {
    const keys = recordKeys();
    const { result } = renderHook(() => useCreateWidget(), {
      wrapper: wrapper(),
    });

    await act(() => result.current.mutateAsync({ data: { displayName: 'A' } }));

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses the key when the same variables are sent again after a failure', async () => {
    const keys = recordKeys(true);
    const { result } = renderHook(
      () => useCreateWidget({ mutation: { retry: 1, retryDelay: 0 } }),
      { wrapper: wrapper() },
    );

    await act(() => result.current.mutateAsync({ data: { displayName: 'A' } }));

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBeNull();
    expect(keys[1]).toBe(keys[0]);
  });

  it('uses a new key for a new set of variables', async () => {
    const keys = recordKeys();
    const { result } = renderHook(() => useCreateWidget(), {
      wrapper: wrapper(),
    });

    await act(() => result.current.mutateAsync({ data: { displayName: 'A' } }));
    await act(() => result.current.mutateAsync({ data: { displayName: 'A' } }));

    expect(keys[1]).not.toBeNull();
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('lets the caller pass its own key', async () => {
    const keys = recordKeys();
    const { result } = renderHook(() => useCreateWidget(), {
      wrapper: wrapper(),
    });

    await act(() =>
      result.current.mutateAsync({
        data: { displayName: 'A' },
        headers: { 'Idempotency-Key': 'mine' },
      }),
    );

    expect(keys).toEqual(['mine']);
  });
});

describe('3 and 4. If-Match and per-request headers', () => {
  it('keeps If-Match required, adds the key beside it and passes request headers on', async () => {
    const seen: Record<string, string | null> = {};
    server.use(
      http.post('*/api/widgets/:widget/rename', ({ request }) => {
        for (const name of [
          'If-Match',
          'Idempotency-Key',
          'X-Extra',
          'Api-Version',
        ]) {
          seen[name] = request.headers.get(name);
        }
        return HttpResponse.json(widgetResponse('wid_1'));
      }),
    );
    const { result } = renderHook(
      () => useRenameWidget({ request: { headers: { 'X-Extra': 'yes' } } }),
      { wrapper: wrapper() },
    );

    await act(() =>
      result.current.mutateAsync({
        widget: 'wid_1',
        data: { displayName: 'B' },
        headers: { 'If-Match': '"v1"' },
      }),
    );

    expect(seen['If-Match']).toBe('"v1"');
    expect(seen['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen['X-Extra']).toBe('yes');
    expect(seen['Api-Version']).toBe('2026-01-01');
  });

  it('types If-Match as required and leaves the global header out of signatures', () => {
    type ArchiveVariables = Parameters<
      ReturnType<typeof useArchiveWidget>['mutate']
    >[0];
    const noHeaders = {};
    const versioned = { 'Idempotency-Key': 'k', 'Api-Version': '1' };

    const archive: ArchiveVariables = {
      widget: 'w',
      headers: { 'If-Match': '"v1"' },
    };
    // @ts-expect-error If-Match is required in the mutation variables
    const missing: ArchiveVariables = { widget: 'w', headers: noHeaders };
    const create: CreateWidgetHeaders = { 'Idempotency-Key': 'k' };
    const keys: keyof CreateWidgetHeaders = 'Idempotency-Key';
    // @ts-expect-error the header the client sets globally is not a parameter
    const global: keyof CreateWidgetHeaders = 'Api-Version';
    const full: ArchiveWidgetHeaders = { 'If-Match': '"v1"', ...versioned };

    expect([archive, missing, create, keys, global, full]).toHaveLength(6);
  });
});

describe('5. response body, headers and errors', () => {
  it('returns the parsed body and keeps the response headers reachable', async () => {
    server.use(
      http.get('*/api/widgets/:widget', () =>
        HttpResponse.json(widgetResponse('wid_1'), {
          headers: { ETag: '"v7"' },
        }),
      ),
    );

    const response = await retrieveWidget('wid_1');

    expect(response.data.id).toBe('wid_1');
    expect(getResponseHeaders(response)?.get('ETag')).toBe('"v7"');
  });

  it('types errors from the fetch function when the document declares no error schema', async () => {
    server.use(
      http.post('*/api/widgets', () =>
        HttpResponse.json(
          {
            error: {
              type: 'invalid_request_error',
              code: 'invalid_name',
              message: 'Bad name.',
              request_id: 'req_9',
            },
          },
          { status: 422 },
        ),
      ),
    );
    const { result } = renderHook(() => useCreateWidget(), {
      wrapper: wrapper(),
    });

    await act(() =>
      result.current
        .mutateAsync({ data: { displayName: '' } })
        .catch(() => undefined),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error: ApiError | null = result.current.error;
    expect(error?.status).toBe(422);
    expect(error?.body?.error.code).toBe('invalid_name');
  });
});

describe('6. query keys', () => {
  it('are built from the operation id', () => {
    expect(getRetrieveWidgetQueryKey('wid_1')[0]).toBe('retrieveWidget');
  });
});

describe('7. mocks', () => {
  it('take a fixture in place of the generated response', async () => {
    server.use(
      getListWidgetsMockHandler({
        object: 'list',
        data: [widget('wid_9')],
        hasMore: false,
        nextCursor: null,
        meta,
      }),
    );

    const { result } = renderHook(() => useListWidgetsInfinite(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]?.data[0]?.id).toBe('wid_9');
  });

  it('produce a valid list by default', () => {
    const list = getListWidgetsResponseMock();

    expect(list.object).toBe('list');
    expect(Array.isArray(list.data)).toBe(true);
    expect(typeof list.hasMore).toBe('boolean');
  });
});
