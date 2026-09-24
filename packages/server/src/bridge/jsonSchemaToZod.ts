import { z } from "zod";

type JsonSchema = Record<string, unknown>;

function toZod(p: JsonSchema): z.ZodTypeAny {
  let t: z.ZodTypeAny;
  switch (p.type) {
    case "string":
      t = Array.isArray(p.enum) && p.enum.length > 0 ? z.enum(p.enum as [string, ...string[]]) : z.string();
      break;
    case "number":
    case "integer":
      t = z.number();
      break;
    case "boolean":
      t = z.boolean();
      break;
    case "array": {
      const items = p.items as JsonSchema | undefined;
      t = z.array(items && typeof items === "object" ? toZod(items) : z.unknown());
      break;
    }
    case "object":
      t = p.properties ? z.object(jsonSchemaToZodShape(p)) : z.record(z.string(), z.unknown());
      break;
    default:
      t = z.unknown();
  }
  if (typeof p.description === "string") t = t.describe(p.description);
  return t;
}

/** Minimal JSON Schema → zod shape for the tool schemas the ToolRegistry emits. */
export function jsonSchemaToZodShape(schema: JsonSchema): Record<string, z.ZodTypeAny> {
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, p] of Object.entries(props)) {
    const t = toZod(p);
    shape[k] = required.has(k) ? t : t.optional();
  }
  return shape;
}
