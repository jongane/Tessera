import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

// Checks a request body (or other input) against a zod schema at the API
// boundary. Anything that does not match, including unknown fields, is
// refused with 400 and a message naming the problem; what passes is the
// cleaned-up value (trimmed, lower-cased, ...), typed by the schema.
//
//   @Body(new ZodPipe(signUpSchema)) body: z.infer<typeof signUpSchema>
export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: result.error.issues
          .map((issue) =>
            issue.path.length > 0
              ? `${issue.path.join('.')}: ${issue.message}`
              : issue.message,
          )
          .join('; '),
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}
