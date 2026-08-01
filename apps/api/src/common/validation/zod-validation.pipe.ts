// Body and query validation, from a zod schema.
//
// Nest's own `ValidationPipe` reads class-validator decorators, which would put
// a second schema language in a repository that has already settled on zod —
// docs/architecture/tech-stack.md. This pipe is the whole adapter: a schema in,
// a 400 with the failing paths out, and the parsed value (not the raw one) on
// the handler's argument, so a coercion or a default declared in the schema is
// actually applied.

import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        // Path and message only. A zod issue also carries the received value,
        // and echoing that back would put a submitted password into a response
        // body and, from there, into whatever logs it.
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}
