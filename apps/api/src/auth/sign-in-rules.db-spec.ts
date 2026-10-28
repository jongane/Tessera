import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { createUser } from '../../test/support/factories.js';

// Accounts and sessions. Like the other *-rules.db-spec.ts files, these
// write to the database directly to prove it refuses bad data.
describe('Sign-in rules (database)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const inADay = () => new Date(Date.now() + 86_400_000);

  it('stores email addresses in lower case only', async () => {
    await expect(
      prisma.user.create({
        data: {
          email: 'Ana@Example.com',
          displayName: 'Ana',
          passwordHash: 'x',
        },
      }),
    ).rejects.toThrow('users_email_lowercase');
  });

  it('never stores the same session token twice', async () => {
    const ana = await createUser(prisma, 'ana');
    const session = { tokenHash: 'abc', userId: ana.id, expiresAt: inADay() };
    await prisma.session.create({ data: session });

    await expect(prisma.session.create({ data: session })).rejects.toThrow(
      'token_hash',
    );
  });

  it('ends a person’s sessions when their account is deleted', async () => {
    const ana = await createUser(prisma, 'ana');
    await prisma.session.create({
      data: { tokenHash: 'abc', userId: ana.id, expiresAt: inADay() },
    });

    await prisma.user.delete({ where: { id: ana.id } });

    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it('keeps exactly one row of server settings, open for sign-up by default', async () => {
    await expect(prisma.serverSettings.findMany()).resolves.toEqual([
      { id: 1, signUpOpen: true },
    ]);
    await expect(
      prisma.serverSettings.create({ data: { id: 2 } }),
    ).rejects.toThrow('server_settings_single_row');
  });
});
