# Patches carried by this fork

Fork of [orval-labs/orval](https://github.com/orval-labs/orval) (MIT). Branch `oxyl`.

**Based on upstream tag:** `v8.47.0`
**Fork release:** `8.47.0-oxyl.1`

Rules for this branch: every patch is one commit with its own test, behind an option that is off by default, with
no project-specific names in the generator. Upstream files are not reformatted, renamed or reorganised. Package
versions are not bumped in the tree (`oxyl/pack.mjs` sets them while packing), so upstream's own version bumps
never conflict.

## Conformance suite

`oxyl/conformance/` is a standalone project, outside the upstream workspace. `conformance.json` is a small OpenAPI
document with the request and response shapes this fork is used against: camelCase fields, `{ data, meta }`
bodies, three kinds of cursor list, required `Idempotency-Key` and `If-Match` header parameters, a header the client
sets globally, and error responses with no schema. `conformance.test.tsx` generates a client from it, type-checks
it, and runs the generated hooks against a mock server.

```sh
vp run build                      # build the fork's packages first
cd oxyl/conformance && npm ci && npm test
```

## Baseline: what unpatched v8.47.0 does

Measured by running the suite against an unpatched build: 8 of 16 tests fail. All 8 trace to gaps 1 and 2.

| # | Need | Unpatched v8.47.0 | Delivered by |
| --- | --- | --- | --- |
| 1 | Infinite hooks page with no paging argument from the caller | **Missing.** Only the request parameter is configurable. `override.query.options.getNextPageParam` works but is deprecated ("will be removed in a future major release") and is one function for every operation | Patch 1 |
| 2 | A mutation creates the idempotency key, reuses it on retry, caller may pass its own | **Missing.** With `output.headers: true` the key is a required argument the caller must make up | Patch 2 |
| 3 | `If-Match` is a typed, required argument | Works | `output.headers: true` |
| 4 | Per-request headers reach the custom fetch function | Works | the `request` option of every hook; second argument of every function |
| 5 | Parsed body returned directly; response headers still reachable | Works | `override.fetch.includeHttpResponseReturnType: false` returns the body. Headers are then not in the return value, so the fetch function keeps them beside the body (`getResponseHeaders` in `oxyl/conformance/mutator.ts`). With the default `true` the return value is `{ data, status, headers }` |
| 6 | Query keys built from the operation id | Works | `override.query.useOperationIdAsQueryKey: true` |
| 7 | Mock handler takes a fixture; default list mock is a valid list | Works | `output.mock: true`; `get<Operation>MockHandler(fixture)` |
| 8 | `--outdated` together with the Biome formatter | **Refused**: "output.formatter "biome" formats the files on disk after generation" | Deferred, below |
| 9 | Keep a header the client sets globally out of generated signatures | Works | `input.override.transformer` removing the parameter (see `oxyl/conformance/orval.config.ts`) |
| 10 | Typed errors when the document declares no error schema | Works | `ErrorType` exported by the custom fetch function |

Also seen on unpatched v8.47.0, and avoided by configuration rather than patched:

- `override.query.useQuery: true` turns every operation, `POST` included, into a query hook. Leave it unset: `GET`
  becomes a query and the other verbs become mutations.
- Generated TanStack Query types follow the version in the nearest `package.json`. With an unresolvable version
  the newest signatures are emitted, which need `@tanstack/react-query` 5.80 or later.

## Patches

### 1. Generate `getNextPageParam` from the response body

Commit `feat(query): generate getNextPageParam from the response body`.
Packages: `@orval/core` (option types), `@orval/query` (generator), `orval` (option normalising).
Tests: `packages/query/src/infinite-page-param.test.ts`; conformance section 1.

```ts
override: {
  query: {
    useInfinite: true,
    useInfiniteQueryParam: 'startingAfter',
    useInfiniteQueryNextPageParam: 'nextCursor',                       // dot path in the response body
    useInfiniteQueryHasNextPage: 'hasMore',                            // dot path to a boolean
    useInfiniteQueryLastItemParam: { items: 'data', property: 'id' },  // fallback
  },
}
```

Resolved per operation from its response schema:

1. The body declares `useInfiniteQueryNextPageParam`: that value is the next page param.
2. Otherwise, with `useInfiniteQueryLastItemParam`, and when the body declares that array and its items declare
   that property: the property of the last item is the next page param.
3. Otherwise nothing is generated and the caller supplies `getNextPageParam`, as before.

When the body declares `useInfiniteQueryHasNextPage`, `false` ends the pages. An item-paged list without it ends
on the first empty page, which costs one extra request. Paths are relative to the response body whether or not
the function returns the `{ data, status, headers }` envelope. The option sits before the caller's own query
options, so a caller can still replace it. `initialPageParam` is not emitted: unpatched Orval doesn't emit it
either, and TanStack Query starts from `undefined`.

Checked with `client: 'react-query'` and `httpClient: 'fetch'`. For axios the envelope is assumed when there is
no mutator; the other framework adapters share the code path but were not run.

Upstream: not yet offered. Useful to any cursor-paginated API.

### 2. Create the idempotency key in generated mutations

Commit `feat(query): create the idempotency key in generated mutations`.
Packages: `@orval/core`, `@orval/query`, `orval`.
Tests: `packages/query/src/mutation-idempotency.test.ts`; conformance section 2.

```ts
output: { headers: true },
override: { query: { mutationIdempotencyHeader: 'Idempotency-Key' } },
```

For a mutation whose operation declares that header parameter:

- The mutation function creates a key with `crypto.randomUUID()` and keeps it against the variables object, so a
  retry, which calls the function again with the same object, sends the same key. A new `mutate` call gets a new
  key.
- The header becomes optional in the mutation variables; a key the caller passes wins.
- Other headers of the operation (`If-Match`) keep their declared required state. When the idempotency header is
  the operation's only header, `headers` as a whole becomes optional.

Only the generated mutation hooks and their options change. The plain request function (`createWidget(...)`) still
takes the header as an argument.

Upstream: not yet offered.

## Deferred

### `--outdated` with the Biome formatter (need 8)

Biome and oxfmt run as a separate command on the files after they are written, and the check compares in memory
without writing, so supporting it means formatting each file in memory through an external process. That reaches
into the write path for every output mode and is out of proportion to the gain.

Interim: generate with no `formatter`, exclude the generated folder from the project's Biome config, and run
`orval --outdated` as the CI check. (`formatter: 'prettier'` is also accepted by `--outdated`.)

## Syncing with upstream

```sh
git fetch upstream --tags
git rebase --onto <new tag> <old tag> oxyl
vp install && vp run build && vp run test      # upstream's suite
cd oxyl/conformance && npm ci && npm test      # ours
node oxyl/pack.mjs <new version>-oxyl.1
```

Then update the tag at the top of this file. Delete a patch that upstream has taken.
