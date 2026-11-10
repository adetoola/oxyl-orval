import type { ContextSpec, GetterResponse } from '@orval/core';
import { describe, expect, it } from 'vite-plus/test';

import { getInfiniteNextPageParamOption } from './infinite-page-param';

const context = { spec: {}, target: 'spec', workspace: '' } as ContextSpec;

const responseOf = (properties: Record<string, unknown>) =>
  ({
    types: {
      success: [
        {
          contentType: 'application/json',
          originalSchema: { type: 'object', properties },
        },
      ],
      errors: [],
    },
  }) as unknown as GetterResponse;

const items = {
  type: 'array',
  items: { type: 'object', properties: { id: { type: 'string' } } },
};

const options = {
  context,
  nextPageParam: 'nextCursor',
  hasNextPage: 'hasMore',
  lastItemParam: { items: 'data', property: 'id' },
  pageParamType: "ListPetsParams['after']",
  isPageEnvelope: false,
};

describe('getInfiniteNextPageParamOption', () => {
  it('emits nothing when nothing is configured', () => {
    expect(
      getInfiniteNextPageParamOption({
        response: responseOf({ nextCursor: { type: 'string' } }),
        context,
        isPageEnvelope: false,
      }),
    ).toBe('');
  });

  it('reads the cursor and the flag the response declares', () => {
    expect(
      getInfiniteNextPageParamOption({
        ...options,
        response: responseOf({
          data: items,
          nextCursor: { type: 'string' },
          hasMore: { type: 'boolean' },
        }),
      }),
    ).toBe(
      "getNextPageParam: (lastPage) => lastPage?.hasMore === false ? undefined : (lastPage?.nextCursor ?? undefined) as unknown as ListPetsParams['after'], ",
    );
  });

  it('leaves the flag out when the response does not declare it', () => {
    expect(
      getInfiniteNextPageParamOption({
        ...options,
        response: responseOf({ nextCursor: { type: 'string' } }),
      }),
    ).toBe(
      "getNextPageParam: (lastPage) => (lastPage?.nextCursor ?? undefined) as unknown as ListPetsParams['after'], ",
    );
  });

  it('reads through the response envelope', () => {
    expect(
      getInfiniteNextPageParamOption({
        ...options,
        isPageEnvelope: true,
        response: responseOf({ nextCursor: { type: 'string' } }),
      }),
    ).toContain('lastPage?.data?.nextCursor');
  });

  it('falls back to the last item of the list', () => {
    const option = getInfiniteNextPageParamOption({
      ...options,
      response: responseOf({ data: items }),
    });

    expect(option).toContain('const items = lastPage?.data;');
    expect(option).toContain('const lastItem = items?.[items.length - 1];');
    expect(option).toContain(
      "lastItem === undefined ? undefined : (lastItem?.id ?? undefined) as unknown as ListPetsParams['after']",
    );
  });

  it('emits nothing when the response declares none of the paths', () => {
    expect(
      getInfiniteNextPageParamOption({
        ...options,
        response: responseOf({ total: { type: 'number' } }),
      }),
    ).toBe('');
  });

  it('emits nothing when the items lack the configured property', () => {
    expect(
      getInfiniteNextPageParamOption({
        ...options,
        response: responseOf({
          data: { type: 'array', items: { type: 'object', properties: {} } },
        }),
      }),
    ).toBe('');
  });
});
