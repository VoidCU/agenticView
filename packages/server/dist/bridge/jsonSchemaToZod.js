import { z } from "zod";
function toZod(p) {
    let t;
    switch (p.type) {
        case "string":
            t = Array.isArray(p.enum) && p.enum.length > 0 ? z.enum(p.enum) : z.string();
            break;
        case "number":
        case "integer":
            t = z.number();
            break;
        case "boolean":
            t = z.boolean();
            break;
        case "array": {
            const items = p.items;
            t = z.array(items && typeof items === "object" ? toZod(items) : z.unknown());
            break;
        }
        case "object":
            t = p.properties ? z.object(jsonSchemaToZodShape(p)) : z.record(z.string(), z.unknown());
            break;
        default:
            t = z.unknown();
    }
    if (typeof p.description === "string")
        t = t.describe(p.description);
    return t;
}
/** Minimal JSON Schema → zod shape for the tool schemas the ToolRegistry emits. */
export function jsonSchemaToZodShape(schema) {
    const props = (schema.properties ?? {});
    const required = new Set((schema.required ?? []));
    const shape = {};
    for (const [k, p] of Object.entries(props)) {
        const t = toZod(p);
        shape[k] = required.has(k) ? t : t.optional();
    }
    return shape;
}
//# sourceMappingURL=jsonSchemaToZod.js.map