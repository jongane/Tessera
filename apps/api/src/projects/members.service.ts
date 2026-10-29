import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, ProjectRole, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { saveTimer } from '../time/timer.service.js';
import type { MemberChanges, NewMember } from '@tessera/shared';
import { requireAdmin, requireMember } from './project-access.js';

export interface MemberView {
  userId: string;
  displayName: string;
  email: string;
  role: ProjectRole;
  joinedAt: Date;
}

// Who belongs to a project. Members can see the list; admins add people
// (by the email of an existing account), change roles and remove people;
// anyone can leave. A project always keeps at least one admin.
@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  // Admins first, then by name.
  async listMembers(userId: string, projectId: string): Promise<MemberView[]> {
    await requireMember(this.prisma, userId, projectId);
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: true },
    });
    return members
      .sort(
        (a, b) =>
          (a.role === 'ADMIN' ? 0 : 1) - (b.role === 'ADMIN' ? 0 : 1) ||
          a.user.displayName.localeCompare(b.user.displayName),
      )
      .map(toView);
  }

  async addMember(
    userId: string,
    projectId: string,
    member: NewMember,
  ): Promise<MemberView> {
    await requireAdmin(this.prisma, userId, projectId, 'add people');
    const account = await this.prisma.user.findUnique({
      where: { email: member.email },
    });
    if (!account) {
      throw new NotFoundException('No account uses that email address');
    }
    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: account.id } },
    });
    if (existing) {
      throw new ConflictException('That person is already a member');
    }
    const added = await this.prisma.projectMember.create({
      data: { projectId, userId: account.id, role: member.role },
      include: { user: true },
    });
    return toView(added);
  }

  async changeRole(
    userId: string,
    projectId: string,
    memberId: string,
    changes: MemberChanges,
  ): Promise<MemberView> {
    await requireAdmin(this.prisma, userId, projectId, 'change roles');
    return this.prisma.$transaction(async (tx) => {
      const member = await lockAndFindMember(tx, projectId, memberId);
      if (member.role === 'ADMIN' && changes.role !== 'ADMIN') {
        await checkAnotherAdmin(tx, projectId, memberId);
      }
      const changed = await tx.projectMember.update({
        where: { projectId_userId: { projectId, userId: memberId } },
        data: { role: changes.role },
        include: { user: true },
      });
      return toView(changed);
    });
  }

  // Removing someone also removes their card assignments. A timer they
  // have running in the project is stopped and its time saved.
  async removeMember(
    userId: string,
    projectId: string,
    memberId: string,
  ): Promise<void> {
    const membership = await requireMember(this.prisma, userId, projectId);
    if (memberId !== userId && membership.role !== 'ADMIN') {
      throw new ForbiddenException('Only a project admin can remove people');
    }
    await this.prisma.$transaction(async (tx) => {
      const member = await lockAndFindMember(tx, projectId, memberId);
      if (member.role === 'ADMIN') {
        await checkAnotherAdmin(tx, projectId, memberId);
      }
      const timer = await tx.runningTimer.findFirst({
        where: { userId: memberId, projectId },
      });
      if (timer) {
        await saveTimer(tx, timer);
      }
      await tx.projectMember.delete({
        where: { projectId_userId: { projectId, userId: memberId } },
      });
    });
  }
}

// Locks the project's row first, so two admins demoting or removing each
// other at the same moment cannot leave the project with none.
async function lockAndFindMember(
  tx: Prisma.TransactionClient,
  projectId: string,
  memberId: string,
) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
  const member = await tx.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: memberId } },
  });
  if (!member) {
    throw new NotFoundException('That person is not a member');
  }
  return member;
}

async function checkAnotherAdmin(
  tx: Prisma.TransactionClient,
  projectId: string,
  memberId: string,
): Promise<void> {
  const otherAdmins = await tx.projectMember.count({
    where: { projectId, role: 'ADMIN', userId: { not: memberId } },
  });
  if (otherAdmins === 0) {
    throw new ConflictException(
      'A project needs at least one admin. Make someone else an admin first.',
    );
  }
}

function toView(member: {
  userId: string;
  role: ProjectRole;
  joinedAt: Date;
  user: User;
}): MemberView {
  return {
    userId: member.userId,
    displayName: member.user.displayName,
    email: member.user.email,
    role: member.role,
    joinedAt: member.joinedAt,
  };
}
