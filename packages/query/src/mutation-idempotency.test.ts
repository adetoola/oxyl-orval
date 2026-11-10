import type { GetterQueryParam } from '@orval/core';
import { describe, expect, it } from 'vite-plus/test';

import {
  getIdempotentHeadersDefinition,
  getIdempotentHeadersImplementation,
} from './mutation-generator';

const headers = (paramNames: string[]): GetterQueryParam => ({
  schema: { name: 'CreatePetHeaders', model: '', imports: [] },
  deps: [],
  isOptional: false,
  paramNames,
});

describe('getIdempotentHeadersDefinition', () => {
  it('makes the headers optional when the key is the only header', () => {
    expect(
      getIdempotentHeadersDefinition(
        'headers',
        headers(['Idempotency-Key']),
        'Idempotency-Key',
      ),
    ).toBe(
      "headers?: Omit<CreatePetHeaders, 'Idempotency-Key'> & Partial<Pick<CreatePetHeaders, 'Idempotency-Key'>>",
    );
  });

  it('keeps the headers required when another header is declared', () => {
    expect(
      getIdempotentHeadersDefinition(
        'headers',
        headers(['If-Match', 'Idempotency-Key']),
        'Idempotency-Key',
      ),
    ).toBe(
      "headers: Omit<CreatePetHeaders, 'Idempotency-Key'> & Partial<Pick<CreatePetHeaders, 'Idempotency-Key'>>",
    );
  });
});

describe('getIdempotentHeadersImplementation', () => {
  const implementation = getIdempotentHeadersImplementation(
    'createPetIdempotencyKeys',
    'Idempotency-Key',
  );

  it('keeps one key per variables object', () => {
    expect(implementation).toContain('createPetIdempotencyKeys.get(props)');
    expect(implementation).toContain(
      'createPetIdempotencyKeys.set(props, idempotencyKey)',
    );
  });

  it('lets a key passed by the caller win', () => {
    expect(implementation).toContain(
      "{ 'Idempotency-Key': idempotencyKey, ...headers }",
    );
  });
});
