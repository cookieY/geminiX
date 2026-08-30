/**
 * OpenAPI 3.1 semantics: `type: array` without `items` means "items of any
 * type". orval 8.27's zod generator emits an invalid zero-argument
 * `zod.array()` for that shape (verified occurrence:
 * RawEvidenceReveal.raw_payload/oneOf, where omitting `items` is a deliberate
 * loose-typing pattern). Translating the
 * documented meaning to an explicit `items: {}` (any) is faithful to the
 * contract: no field, type union or endpoint changes. Remove this transformer
 * once upstream orval generation handles itemless arrays natively.
 */
type OpenApiDocument = Record<string, unknown>;

export function addItemsToBareArrays(spec: OpenApiDocument): OpenApiDocument {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.type === "array" && !("items" in record)) {
        record.items = {};
      }
      Object.values(record).forEach(visit);
    }
  };
  visit(spec);
  return spec;
}
