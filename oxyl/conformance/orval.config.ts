import { defineConfig } from '../../packages/orval/dist/index.mjs';

/** Headers the client sets on every request; kept out of generated signatures. */
const GLOBAL_HEADERS = new Set(['Api-Version']);

interface Operation {
  parameters?: { in?: string; name?: string }[];
}

interface OpenApiDocument {
  paths?: Record<string, Record<string, Operation>>;
}

const removeGlobalHeaders = <T extends OpenApiDocument>(spec: T): T => {
  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const operation of Object.values(pathItem)) {
      if (Array.isArray(operation.parameters)) {
        operation.parameters = operation.parameters.filter(
          ({ in: location, name }) =>
            !(location === 'header' && name && GLOBAL_HEADERS.has(name)),
        );
      }
    }
  }
  return spec;
};

export default defineConfig({
  conformance: {
    input: {
      target: './conformance.json',
      override: { transformer: removeGlobalHeaders },
    },
    output: {
      target: './generated/endpoints.ts',
      schemas: './generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      mode: 'tags-split',
      clean: true,
      baseUrl: 'http://api.test',
      headers: true,
      mock: true,
      override: {
        mutator: { path: './mutator.ts', name: 'customFetch' },
        fetch: { includeHttpResponseReturnType: false },
        query: {
          version: 5,
          useInfinite: true,
          useInfiniteQueryParam: 'startingAfter',
          useInfiniteQueryNextPageParam: 'nextCursor',
          useInfiniteQueryHasNextPage: 'hasMore',
          useInfiniteQueryLastItemParam: { items: 'data', property: 'id' },
          mutationIdempotencyHeader: 'Idempotency-Key',
          useOperationIdAsQueryKey: true,
          signal: true,
        },
      },
    },
  },
});
