import {
  type ContextSpec,
  type GetterResponse,
  type InfiniteQueryLastItemParam,
  isObject,
  type OpenApiReferenceObject,
  resolveRef,
} from '@orval/core';

const JSON_CONTENT_TYPE = /^application\/(?:[\w.+-]+\+)?json\b/i;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

type Schema = Record<string, unknown>;

const resolveSchema = (schema: unknown, context: ContextSpec) => {
  if (!isObject(schema)) return;

  return (
    '$ref' in schema
      ? resolveRef<object>(schema as OpenApiReferenceObject, context).schema
      : schema
  ) as Schema;
};

const getProperty = (
  schema: Schema,
  name: string,
  context: ContextSpec,
): Schema | undefined => {
  if (isObject(schema.properties) && name in schema.properties) {
    return resolveSchema((schema.properties as Schema)[name], context);
  }

  if (Array.isArray(schema.allOf)) {
    for (const member of schema.allOf) {
      const resolved = resolveSchema(member, context);
      const property = resolved && getProperty(resolved, name, context);
      if (property) return property;
    }
  }

  return undefined;
};

/** The schema a dot path points at, or `undefined` when it is not declared. */
const getSchemaAtPath = (
  schema: Schema | undefined,
  path: string,
  context: ContextSpec,
) => {
  let current = schema;
  for (const segment of path.split('.')) {
    if (!current) return;
    current = getProperty(current, segment, context);
  }
  return current;
};

const getSuccessSchema = (response: GetterResponse, context: ContextSpec) => {
  const success = response.types.success.find(
    ({ contentType, originalSchema }) =>
      JSON_CONTENT_TYPE.test(contentType) && !!originalSchema,
  );

  return resolveSchema(success?.originalSchema, context);
};

const getAccessor = (root: string, path: string) => {
  let accessor = root;
  for (const segment of path.split('.')) {
    accessor += IDENTIFIER.test(segment)
      ? `?.${segment}`
      : `?.['${segment.replaceAll("'", String.raw`\'`)}']`;
  }
  return accessor;
};

/**
 * The `getNextPageParam` property of an infinite query's options, generated
 * from where the response body carries its paging data, or `''` when the
 * operation's response declares none of the configured paths — the caller then
 * supplies `getNextPageParam`, as before.
 *
 * `nextPageParam` wins when the body declares it: the value at that path is the
 * next page param. Otherwise `lastItemParam` reads it from the last item of
 * the list the body returns, for APIs that page by item rather than by cursor.
 * `hasNextPage`, when declared, ends the pages as soon as it is `false`; an
 * item-paged list without it ends on the first empty page.
 */
export const getInfiniteNextPageParamOption = ({
  response,
  context,
  nextPageParam,
  hasNextPage,
  lastItemParam,
  pageParamType,
  isPageEnvelope,
}: {
  response: GetterResponse;
  context: ContextSpec;
  nextPageParam?: string;
  hasNextPage?: string;
  lastItemParam?: InfiniteQueryLastItemParam;
  pageParamType?: string;
  /** The query function resolves to `{ data, status, headers }`, not the body. */
  isPageEnvelope: boolean;
}): string => {
  if (!nextPageParam && !lastItemParam) return '';

  let schema: Schema | undefined;
  try {
    schema = getSuccessSchema(response, context);
  } catch {
    return '';
  }
  if (!schema) return '';

  const declares = (path: string | undefined): path is string => {
    try {
      return !!path && !!getSchemaAtPath(schema, path, context);
    } catch {
      return false;
    }
  };

  const body = isPageEnvelope ? 'lastPage?.data' : 'lastPage';
  const cast = pageParamType ? ` as unknown as ${pageParamType}` : '';
  const isLastPage = declares(hasNextPage)
    ? `${getAccessor(body, hasNextPage)} === false`
    : undefined;

  if (declares(nextPageParam)) {
    const value = `(${getAccessor(body, nextPageParam)} ?? undefined)${cast}`;

    return `getNextPageParam: (lastPage) => ${
      isLastPage ? `${isLastPage} ? undefined : ${value}` : value
    }, `;
  }

  if (lastItemParam) {
    let items: Schema | undefined;
    try {
      const list = getSchemaAtPath(schema, lastItemParam.items, context);
      items = list && resolveSchema(list.items, context);
    } catch {
      return '';
    }
    if (!items || !getProperty(items, lastItemParam.property, context)) {
      return '';
    }

    const value = `(${getAccessor('lastItem', lastItemParam.property)} ?? undefined)${cast}`;

    return `getNextPageParam: (lastPage) => {
      const items = ${getAccessor(body, lastItemParam.items)};
      const lastItem = items?.[items.length - 1];
      return ${isLastPage ? `${isLastPage} || ` : ''}lastItem === undefined ? undefined : ${value};
    }, `;
  }

  return '';
};
