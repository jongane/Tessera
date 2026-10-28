import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../generated/prisma/client.js';

// What the API shares about an account. Never the password hash.
export type SignedInUser = Pick<
  User,
  'id' | 'email' | 'displayName' | 'isServerAdmin'
>;

export const signedInUserFields = {
  id: true,
  email: true,
  displayName: true,
  isServerAdmin: true,
} as const;

export type AuthenticatedRequest = Request & {
  user?: SignedInUser;
  sessionId?: string;
};

// The person making the request, put there by AuthGuard.
//   @Get() list(@CurrentUser() user: SignedInUser) { ... }
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SignedInUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user!;
  },
);

export const IS_PUBLIC = 'isPublic';

// Marks an endpoint anyone can call without signing in, such as sign-in
// itself. Every other endpoint needs a session.
export const Public = () => SetMetadata(IS_PUBLIC, true);
