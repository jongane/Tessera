import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE, setSessionCookie } from './session-cookie.js';
import { type AuthenticatedRequest, IS_PUBLIC } from './signed-in-user.js';

// Runs before every endpoint (registered in AuthModule). Finds the person
// from the session cookie, or refuses with 401. Endpoints marked @Public()
// are let through without a session.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const cookies = request.cookies as Record<string, string> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    const session = token ? await this.auth.findSession(token) : null;
    if (!token || !session) {
      throw new UnauthorizedException('Please sign in');
    }
    if (session.extended) {
      setSessionCookie(http.getResponse<Response>(), token);
    }
    request.user = session.user;
    request.sessionId = session.sessionId;
    return true;
  }
}
