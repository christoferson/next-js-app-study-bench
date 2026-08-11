import type { z } from "zod";
import { ValidationError } from "@/shared/domain-error";

/**
 * Single entry point for parsing external input.
 *
 * Every module validates form fields and action arguments through this helper so
 * a schema failure always arrives at the UI as a `ValidationError` whose
 * messages are already grouped by field name (`spec/CODING-STANDARDS.md`
 * section 2).
 */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  throw new ValidationError(toFieldMessages(result.error));
}

function toFieldMessages(
  error: z.ZodError,
): Readonly<Record<string, readonly string[]>> {
  const messages: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.map((segment) => String(segment)).join(".");
    const existing = messages[field] ?? [];
    existing.push(issue.message);
    messages[field] = existing;
  }

  return messages;
}
