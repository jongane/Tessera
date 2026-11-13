import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { SESSION_COOKIE } from '../auth/session-cookie.js';
import { hashToken } from '../auth/session-token.js';
import { from, type Observable, switchMap } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/signed-in-user.js';
import { type Rule, liveRules } from './live-rules.js';
import { connectionIdFrom } from './live-signal.js';
import { LiveService } from './live.service.js';

const GLOBAL_PREFIX = '/api/';
const uuid = z.uuid();

// Watches every save (an endpoint that changes something) and, once it has
// worked, sends the live signals its rule in live-rules.ts asks for. A save
// that fails (400, 403, 404, 409) sends nothing. Kept out of the services,
// so they stay free of the live connection.
@Injectable()
export class LiveInterceptor implements NestInterceptor {
  private readonly log = new Logger(LiveInterceptor.name);

  constructor(private readonly live: LiveService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const rule = ruleFor(request);
    if (!rule) {
      return next.handle();
    }
    const response = http.getResponse<Response>();
    return from(this.prepare(rule, request, response)).pipe(
      switchMap((after) =>
        next.handle().pipe(
          switchMap(async (result) => {
            await this.finish(after, result);
            return result;
          }),
        ),
      ),
    );
  }

  private async prepare(
    rule: Rule,
    request: AuthenticatedRequest,
    response: Response,
  ) {
    // A malformed id is refused by the endpoint itself, quietly.
    if (
      !Object.values(request.params).every((v) => uuid.safeParse(v).success)
    ) {
      return null;
    }
    const cookies = request.cookies as Record<string, string> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    try {
      return await rule({
        live: this.live,
        by: this.live.attribute(
          connectionIdFrom(request.get('x-live-connection')),
          token ? hashToken(token) : null,
        ),
        userId: request.user?.id,
        params: request.params as Record<string, string>,
        body: request.body as Record<string, unknown> | undefined,
        cookies,
        statusCode: () => response.statusCode,
      });
    } catch (error) {
      this.log.warn(`Live signals skipped: ${String(error)}`);
      return null;
    }
  }

  private async finish(
    after: Awaited<ReturnType<LiveInterceptor['prepare']>>,
    result: unknown,
  ): Promise<void> {
    try {
      await after?.(result);
    } catch (error) {
      this.log.warn(`Live signals not sent: ${String(error)}`);
    }
  }
}

function ruleFor(request: Request): Rule | undefined {
  if (request.method === 'GET') {
    return undefined;
  }
  const path = (request.route as { path?: string } | undefined)?.path;
  if (!path?.startsWith(GLOBAL_PREFIX)) {
    return undefined;
  }
  return liveRules[`${request.method} ${path.slice(GLOBAL_PREFIX.length)}`];
}
