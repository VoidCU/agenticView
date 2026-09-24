import { z } from "zod";
type JsonSchema = Record<string, unknown>;
/** Minimal JSON Schema → zod shape for the tool schemas the ToolRegistry emits. */
export declare function jsonSchemaToZodShape(schema: JsonSchema): Record<string, z.ZodTypeAny>;
export {};
