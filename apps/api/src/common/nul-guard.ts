import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasNul, NUL_MESSAGE } from '@tessera/shared';

const NUL_ALLOWED_IN = 'nulAllowedIn';

// Marks an endpoint whose body may hold a NUL in the named top-level fields,
// such as a password that was saved before NUL was refused.
//
//   @AllowNulIn('password')
export const AllowNulIn = (...fields: string[]) =>
  SetMetadata(NUL_ALLOWED_IN, fields);

// True if a NUL is in the value, in any key or text, at any depth. It uses
// its own stack, not recursion, so a deeply nested body cannot overflow the
// call stack.
export function holdsNul(value: unknown): boolean {
  const pending = [value];
  while (pending.length > 0) {
    const item = pending.pop();
    if (typeof item === 'string') {
      if (hasNul(item)) return true;
    } else if (Array.isArray(item)) {
      pending.push(...item);
    } else if (item !== null && typeof item === 'object') {
      for (const [key, inner] of Object.entries(item)) {
        if (hasNul(key)) return true;
        pending.push(inner);
      }
    }
  }
  return false;
}

function withoutFields(body: unknown, fields: string[]): unknown {
  if (fields.length === 0 || body === null || typeof body !== 'object') {
    return body;
  }
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !fields.includes(key)),
  );
}

// Runs before every endpoint, and so before the zod rules. Refuses with 400
// any request with a NUL in its body, query string or URL, so PostgreSQL
// never gets one to fail on (that would be a 500). It catches fields the
// shared rules do not name.
@Injectable()
export class NulGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const allowed =
      this.reflector.get<string[] | undefined>(
        NUL_ALLOWED_IN,
        context.getHandler(),
      ) ?? [];
    const parts = [
      withoutFields(request.body, allowed),
      request.query,
      request.params,
    ];
    if (parts.some(holdsNul)) {
      throw new BadRequestException(NUL_MESSAGE);
    }
    return true;
  }
}
