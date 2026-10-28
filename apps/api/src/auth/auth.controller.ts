import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodPipe } from '../common/zod-pipe.js';
import {
  type ChangePassword,
  changePasswordSchema,
  type SignIn,
  signInSchema,
  type SignUp,
  signUpSchema,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import {
  clearSessionCookie,
  SESSION_COOKIE,
  setSessionCookie,
} from './session-cookie.js';
import { CurrentUser, Public, type SignedInUser } from './signed-in-user.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('sign-up')
  async signUp(
    @Body(new ZodPipe(signUpSchema)) body: SignUp,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignedInUser> {
    const { user, token } = await this.auth.signUp(body);
    setSessionCookie(response, token);
    return user;
  }

  @Public()
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body(new ZodPipe(signInSchema)) body: SignIn,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignedInUser> {
    try {
      const { user, token } = await this.auth.signIn(body);
      setSessionCookie(response, token);
      return user;
    } catch (error) {
      setRetryAfter(error, response);
      throw error;
    }
  }

  // Public, so a browser whose session already ended can still clear its
  // cookie.
  @Public()
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const cookies = request.cookies as Record<string, string> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    if (token) {
      await this.auth.signOut(token);
    }
    clearSessionCookie(response);
  }

  @Get('me')
  me(@CurrentUser() user: SignedInUser): SignedInUser {
    return user;
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: SignedInUser,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePassword,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = await this.auth.changePassword(user.id, body);
    setSessionCookie(response, token);
  }
}

// Tells the browser how long to wait after too many failed sign-ins.
function setRetryAfter(error: unknown, response: Response): void {
  if (
    error instanceof HttpException &&
    error.getStatus() === Number(HttpStatus.TOO_MANY_REQUESTS)
  ) {
    const body = error.getResponse() as { retryAfterSeconds: number };
    response.setHeader('Retry-After', String(body.retryAfterSeconds));
  }
}
