import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ChangePassword, SignIn, SignUp } from './auth.schemas.js';
import { hashPassword, verifyPassword } from './password.js';
import { SESSION_LIFETIME_MS } from './session-cookie.js';
import { hashToken, newSessionToken } from './session-token.js';
import { type SignedInUser, signedInUserFields } from './signed-in-user.js';

const MAX_FAILED_SIGN_INS = 5;
const FAILED_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
// A session's expiry moves forward at most this often, so most requests
// only read the session and do not write to the database.
const EXTEND_SESSION_AFTER_MS = 60 * 60 * 1000;
const WRONG_SIGN_IN = 'Wrong email or password';

export interface NewSession {
  user: SignedInUser;
  // Goes to the browser in the cookie. Only its hash is saved.
  token: string;
}

export interface FoundSession {
  user: SignedInUser;
  sessionId: string;
  // True when the expiry moved forward, so the cookie should be renewed.
  extended: boolean;
}

@Injectable()
export class AuthService {
  // Compared against when the email is unknown, so a wrong email takes as
  // long as a wrong password and the two cannot be told apart.
  private readonly unknownUserHash = hashPassword('no account has this');

  constructor(private readonly prisma: PrismaService) {}

  // The first account on a new server becomes its server admin, and can be
  // made even when sign-up is switched off.
  async signUp(input: SignUp): Promise<NewSession> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // One sign-up at a time, so two people cannot both be "first".
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tessera.sign_up'))`;
        const isFirst = (await tx.user.count()) === 0;
        const settings = await tx.serverSettings.findUniqueOrThrow({
          where: { id: 1 },
        });
        if (!isFirst && !settings.signUpOpen) {
          throw new ForbiddenException(
            'Sign-up is switched off on this server',
          );
        }
        const user = await tx.user.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            passwordHash,
            isServerAdmin: isFirst,
          },
          select: signedInUserFields,
        });
        return { user, token: await startSession(tx, user.id) };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with that email already exists',
        );
      }
      throw error;
    }
  }

  // After 5 failed attempts in 15 minutes, an email must wait, even with
  // the right password, so passwords cannot be guessed quickly.
  async signIn(input: SignIn): Promise<NewSession> {
    await this.checkNotTooManyFailures(input.email);
    const account = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    const passwordOk = await verifyPassword(
      input.password,
      account?.passwordHash ?? (await this.unknownUserHash),
    );
    if (!account || !passwordOk) {
      await this.recordFailure(input.email);
      throw new UnauthorizedException(WRONG_SIGN_IN);
    }
    await this.prisma.failedSignIn.deleteMany({
      where: { email: input.email },
    });
    return {
      user: pickSignedInUser(account),
      token: await startSession(this.prisma, account.id),
    };
  }

  async signOut(token: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }

  // The session's person, or null when the token is unknown or expired.
  // Moves the expiry forward while the session is in use.
  async findSession(token: string): Promise<FoundSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: signedInUserFields } },
    });
    const now = Date.now();
    if (!session || session.expiresAt.getTime() <= now) {
      return null;
    }
    const extended =
      now - session.lastUsedAt.getTime() > EXTEND_SESSION_AFTER_MS;
    if (extended) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          lastUsedAt: new Date(now),
          expiresAt: new Date(now + SESSION_LIFETIME_MS),
        },
      });
    }
    return { user: session.user, sessionId: session.id, extended };
  }

  // Ends every session of the account, then starts a new one for the
  // browser that made the change.
  async changePassword(userId: string, input: ChangePassword): Promise<string> {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (!(await verifyPassword(input.currentPassword, account.passwordHash))) {
      throw new ForbiddenException('The current password is wrong');
    }
    const passwordHash = await hashPassword(input.newPassword);
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId } });
      return startSession(tx, userId);
    });
  }

  private async checkNotTooManyFailures(email: string): Promise<void> {
    const since = new Date(Date.now() - FAILED_SIGN_IN_WINDOW_MS);
    const failures = await this.prisma.failedSignIn.findMany({
      where: { email, createdAt: { gt: since } },
      orderBy: { createdAt: 'desc' },
      take: MAX_FAILED_SIGN_INS,
      select: { createdAt: true },
    });
    if (failures.length < MAX_FAILED_SIGN_INS) {
      return;
    }
    const oldest = failures[failures.length - 1]!.createdAt.getTime();
    const waitSeconds = Math.ceil(
      (oldest + FAILED_SIGN_IN_WINDOW_MS - Date.now()) / 1000,
    );
    throw new HttpException(
      {
        message: 'Too many failed sign-ins. Try again later.',
        retryAfterSeconds: waitSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async recordFailure(email: string): Promise<void> {
    await this.prisma.failedSignIn.create({ data: { email } });
    await this.prisma.failedSignIn.deleteMany({
      where: {
        createdAt: { lt: new Date(Date.now() - FAILED_SIGN_IN_WINDOW_MS) },
      },
    });
  }
}

async function startSession(
  db: Prisma.TransactionClient,
  userId: string,
): Promise<string> {
  const token = newSessionToken();
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
    },
  });
  return token;
}

function pickSignedInUser(user: SignedInUser): SignedInUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isServerAdmin: user.isServerAdmin,
  };
}
