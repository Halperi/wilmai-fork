/** Validate the JSON Schema subset used by Home, including nullable fields. */
export function validateStructured(value: unknown, schema: Record<string, unknown>, path = "$"): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (!types.includes(type) && !(types.includes("integer") && type === "number" && Number.isInteger(value))) throw new Error(`${path}: expected ${types.join(" or ")}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new Error(`${path}: not an allowed value`);
  if (type === "object") {
    const obj = value as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>> ?? {};
    for (const key of schema.required as string[] ?? []) if (!(key in obj)) throw new Error(`${path}.${key}: missing`);
    for (const [key, v] of Object.entries(obj)) {
      if (properties[key]) validateStructured(v, properties[key], `${path}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${path}.${key}: unexpected field`);
    }
  }
  if (type === "array") for (const [i, v] of (value as unknown[]).entries()) validateStructured(v, schema.items as Record<string, unknown>, `${path}[${i}]`);
  if (type === "number" && !Number.isFinite(value)) throw new Error(`${path}: not finite`);
}
