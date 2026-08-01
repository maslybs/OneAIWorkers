export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateJsonSchema(schema: unknown, value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  validate(schema, value, "$", errors);
  return { valid: errors.length === 0, errors: errors.slice(0, 20) };
}

function validate(schema: unknown, value: unknown, path: string, errors: string[]): void {
  if (errors.length >= 20 || !isRecord(schema)) return;
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(candidate, value))) {
    errors.push(`${path} must be one of the allowed values.`);
    return;
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => validateJsonSchema(candidate, value).valid).length;
    if (matches !== 1) errors.push(`${path} must match exactly one allowed shape.`);
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some((candidate) => validateJsonSchema(candidate, value).valid)) {
      errors.push(`${path} does not match any allowed shape.`);
    }
    return;
  }

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => matchesType(String(type), value))) {
    errors.push(`${path} must be ${types.join(" or ")}.`);
    return;
  }

  if (typeof value === "string") {
    if (Number.isFinite(schema.minLength) && value.length < Number(schema.minLength)) errors.push(`${path} is too short.`);
    if (Number.isFinite(schema.maxLength) && value.length > Number(schema.maxLength)) errors.push(`${path} is too long.`);
    if (typeof schema.pattern === "string") {
      try { if (!(new RegExp(schema.pattern, "u")).test(value)) errors.push(`${path} has an invalid format.`); } catch { errors.push(`${path} uses an invalid schema pattern.`); }
    }
  }
  if (typeof value === "number") {
    if (Number.isFinite(schema.minimum) && value < Number(schema.minimum)) errors.push(`${path} is below the minimum.`);
    if (Number.isFinite(schema.maximum) && value > Number(schema.maximum)) errors.push(`${path} is above the maximum.`);
  }
  if (Array.isArray(value)) {
    if (Number.isFinite(schema.minItems) && value.length < Number(schema.minItems)) errors.push(`${path} has too few items.`);
    if (Number.isFinite(schema.maxItems) && value.length > Number(schema.maxItems)) errors.push(`${path} has too many items.`);
    if (schema.items) value.forEach((item, index) => validate(schema.items, item, `${path}/${index}`, errors));
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
    for (const key of required) if (!(key in value)) errors.push(`${path}/${escapePointer(key)} is required.`);
    for (const [key, child] of Object.entries(value)) {
      if (key in properties) validate(properties[key], child, `${path}/${escapePointer(key)}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}/${escapePointer(key)} is not allowed.`);
      else if (isRecord(schema.additionalProperties)) validate(schema.additionalProperties, child, `${path}/${escapePointer(key)}`, errors);
    }
  }
}

function matchesType(type: string, value: unknown): boolean {
  if (type === "null") return value === null;
  if (type === "object") return isRecord(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  return true;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
