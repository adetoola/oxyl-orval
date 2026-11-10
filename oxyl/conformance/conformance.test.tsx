import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Widget, WidgetList } from './generated/model';
import {
  getRetrieveWidgetQueryKey,
  retrieveWidget,
  useArchiveWidget,
  useCreateWidget,
  useListWidgetsInfinite,
  useUpdateWidget,
} from './generated/widgets/widgets';
import {
  getListWidgetsMockHandler,
  getListWidgetsResponseMock,
} from './generated/widgets/widgets.msw';

const widget = (id: string): Widget => ({
  id,
  object: 'widget',
  display_name: `Widget ${id}`,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  archived_at: null,
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

describe('1. cursor lists page without caller-supplied paging options', () => {
  it('sends next_cursor as starting_after and stops when has_more is false', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      getListWidgetsMockHandler(({ request }) => {
        const cursor = new URL(request.url).searchParams.get('starting_after');
        cursors.push(cursor);
        const page: WidgetList =
          cursor === null
            ? { object: 'list', data: [widget('wid_1')], has_more: true, next_cursor: 'cur_1' }
            : { object: 'list', data: [widget('wid_2')], has_more: false, next_cursor: null };
        return page;
      }),
    );

    const { result } = renderHook(() => useListWidgetsInfinite(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(() => result.current.fetchNextPage());

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(cursors).toEqual([null, 'cur_1']);
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe('2. idempotent mutations', () => {
  const recordKeys = (failFirst = false) => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('*/widgets', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return failFirst && keys.length === 1
          ? HttpResponse.error()
          : HttpResponse.json(widget('wid_1'), { status: 201 });
      }),
    );
    return keys;
  };

  it('creates a key when the caller passes none', async () => {
    const keys = recordKeys();
    const { result } = renderHook(() => useCreateWidget(), { wrapper: wrapper() });

    await act(() => result.current.mutateAsync({ data: { display_name: 'A' } }));

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses the key when the same variables are sent again after a failure', async () => {
    const keys = recordKeys(true);
    const { result } = renderHook(
      () => useCreateWidget({ mutation: { retry: 1, retryDelay: 0 } }),
      { wrapper: wrapper() },
    );

    await act(() => result.current.mutateAsync({ data: { display_name: 'A' } }));

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBeNull();
    expect(keys[1]).toBe(keys[0]);
  });

  it('uses a new key for a new set of variables', async () => {
    const keys = recordKeys();
    const { result } = renderHook(() => useCreateWidget(), { wrapper: wrapper() });

    await act(() => result.current.mutateAsync({ data: { display_name: 'A' } }));
    await act(() => result.current.mutateAsync({ data: { display_name: 'A' } }));

    expect(keys[1]).not.toBe(keys[0]);
  });

  it('lets the caller pass its own key', async () => {
    const keys = recordKeys();
    const { result } = renderHook(() => useCreateWidget(), { wrapper: wrapper() });

    await act(() =>
      result.current.mutateAsync({
        data: { display_name: 'A' },
        headers: { 'Idempotency-Key': 'mine' },
      }),
    );

    expect(keys).toEqual(['mine']);
  });

  it('keeps other required headers required and adds the key beside them', async () => {
    const seen: Record<string, string | null> = {};
    server.use(
      http.post('*/widgets/:widget/archive', ({ request }) => {
        seen.key = request.headers.get('Idempotency-Key');
        seen.match = request.headers.get('If-Match');
        return HttpResponse.json(widget('wid_1'));
      }),
    );
    const { result } = renderHook(() => useArchiveWidget(), { wrapper: wrapper() });

    await act(() =>
      result.current.mutateAsync({ widget: 'wid_1', headers: { 'If-Match': '"v1"' } }),
    );

    expect(seen.match).toBe('"v1"');
    expect(seen.key).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('3 and 4. If-Match and per-request headers', () => {
  it('sends If-Match from the variables and extra headers from the request option', async () => {
    const seen: Record<string, string | null> = {};
    server.use(
      http.patch('*/widgets/:widget', ({ request }) => {
        seen.match = request.headers.get('If-Match');
        seen.extra = request.headers.get('X-Extra');
        return HttpResponse.json(widget('wid_1'));
      }),
    );
    const { result } = renderHook(
      () => useUpdateWidget({ request: { headers: { 'X-Extra': 'yes' } } }),
      { wrapper: wrapper() },
    );

    await act(() =>
      result.current.mutateAsync({
        widget: 'wid_1',
        data: { display_name: 'B' },
        headers: { 'If-Match': '"v1"' },
      }),
    );

    expect(seen).toEqual({ match: '"v1"', extra: 'yes' });
  });
});

describe('5. ETag', () => {
  it('returns response headers to the caller', async () => {
    server.use(
      http.get('*/widgets/:widget', () =>
        HttpResponse.json(widget('wid_1'), { headers: { ETag: '"v7"' } }),
      ),
    );

    const response = await retrieveWidget('wid_1');

    expect(response.headers.get('ETag')).toBe('"v7"');
    expect(response.data.id).toBe('wid_1');
  });
});

describe('6. query keys', () => {
  it('are built from the operation id', () => {
    expect(getRetrieveWidgetQueryKey('wid_1')[0]).toBe('retrieveWidget');
  });
});

describe('7. mocks', () => {
  it('produce a valid list envelope by default', () => {
    const list = getListWidgetsResponseMock();

    expect(list.object).toBe('list');
    expect(Array.isArray(list.data)).toBe(true);
    expect(typeof list.has_more).toBe('boolean');
  });
});
