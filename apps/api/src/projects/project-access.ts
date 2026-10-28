import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma, ProjectMember } from '../generated/prisma/client.js';

// The user's membership of the project. Someone who is not a member is told
// the project was not found, so they cannot tell whether it exists.
export async function requireMember(
  db: Prisma.TransactionClient,
  userId: string,
  projectId: string,
): Promise<ProjectMember> {
  const membership = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (!membership) {
    throw new NotFoundException('Project not found');
  }
  return membership;
}

// Like requireMember, but also refuses members who are not admins.
// `action` finishes the sentence "Only a project admin can ...".
export async function requireAdmin(
  db: Prisma.TransactionClient,
  userId: string,
  projectId: string,
  action: string,
): Promise<ProjectMember> {
  const membership = await requireMember(db, userId, projectId);
  if (membership.role !== 'ADMIN') {
    throw new ForbiddenException(`Only a project admin can ${action}`);
  }
  return membership;
}
