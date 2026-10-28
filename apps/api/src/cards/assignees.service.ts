import { BadRequestException, Injectable } from '@nestjs/common';
import type { CardAssignee, Prisma, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { findVisibleCard, lockCard } from './card-access.js';
import { personRef, recordActivity } from '../activity/activity.js';

export type AssigneeWithPerson = CardAssignee & {
  user: Pick<User, 'id' | 'displayName'>;
};

// Who is assigned to a card (docs/card-features.md, section 3). When a card
// has assignees, exactly one is the owner: the first person assigned, until
// someone changes it. Each method returns the card's assignees afterwards,
// owner first. Any project member can change them.
@Injectable()
export class AssigneesService {
  constructor(private readonly prisma: PrismaService) {}

  async assign(
    userId: string,
    cardId: string,
    assigneeId: string,
  ): Promise<AssigneeWithPerson[]> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    const member = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: { projectId: card.projectId, userId: assigneeId },
      },
    });
    if (!member) {
      throw new BadRequestException('Only project members can be assigned');
    }

    return this.prisma.$transaction(async (tx) => {
      await lockCard(tx, card.id);
      const current = await tx.cardAssignee.findMany({
        where: { cardId: card.id },
      });
      if (!current.some((a) => a.userId === assigneeId)) {
        const isOwner = current.length === 0;
        await tx.cardAssignee.create({
          data: {
            cardId: card.id,
            projectId: card.projectId,
            userId: assigneeId,
            isOwner,
          },
        });
        await recordActivity(tx, card, userId, 'ASSIGNEE_ADDED', {
          user: await personRef(tx, assigneeId),
          isOwner,
        });
      }
      return listFor(tx, card.id);
    });
  }

  // Removing the owner hands ownership to the person assigned longest.
  async unassign(
    userId: string,
    cardId: string,
    assigneeId: string,
  ): Promise<AssigneeWithPerson[]> {
    const card = await findVisibleCard(this.prisma, userId, cardId);

    return this.prisma.$transaction(async (tx) => {
      await lockCard(tx, card.id);
      const removed = await tx.cardAssignee.findUnique({
        where: { cardId_userId: { cardId: card.id, userId: assigneeId } },
      });
      if (!removed) {
        return listFor(tx, card.id);
      }
      await tx.cardAssignee.delete({
        where: { cardId_userId: { cardId: card.id, userId: assigneeId } },
      });
      const removedPerson = await personRef(tx, assigneeId);
      await recordActivity(tx, card, userId, 'ASSIGNEE_REMOVED', {
        user: removedPerson,
      });
      if (removed.isOwner) {
        const next = await tx.cardAssignee.findFirst({
          where: { cardId: card.id },
          orderBy: [{ assignedAt: 'asc' }, { userId: 'asc' }],
        });
        if (next) {
          await tx.cardAssignee.update({
            where: { cardId_userId: { cardId: card.id, userId: next.userId } },
            data: { isOwner: true },
          });
          await recordActivity(tx, card, userId, 'OWNER_CHANGED', {
            from: removedPerson,
            to: await personRef(tx, next.userId),
          });
        }
      }
      return listFor(tx, card.id);
    });
  }

  async setOwner(
    userId: string,
    cardId: string,
    ownerId: string,
  ): Promise<AssigneeWithPerson[]> {
    const card = await findVisibleCard(this.prisma, userId, cardId);

    return this.prisma.$transaction(async (tx) => {
      await lockCard(tx, card.id);
      const owner = await tx.cardAssignee.findUnique({
        where: { cardId_userId: { cardId: card.id, userId: ownerId } },
      });
      if (!owner) {
        throw new BadRequestException(
          'The owner must be one of the card’s assignees',
        );
      }
      if (owner.isOwner) {
        return listFor(tx, card.id);
      }
      const oldOwner = await tx.cardAssignee.findFirst({
        where: { cardId: card.id, isOwner: true },
      });
      // Clear the old owner first: the database allows only one at a time.
      await tx.cardAssignee.updateMany({
        where: { cardId: card.id, isOwner: true },
        data: { isOwner: false },
      });
      await recordActivity(tx, card, userId, 'OWNER_CHANGED', {
        from: oldOwner && (await personRef(tx, oldOwner.userId)),
        to: await personRef(tx, ownerId),
      });
      await tx.cardAssignee.update({
        where: { cardId_userId: { cardId: card.id, userId: ownerId } },
        data: { isOwner: true },
      });
      return listFor(tx, card.id);
    });
  }

  async listAssignees(
    userId: string,
    cardId: string,
  ): Promise<AssigneeWithPerson[]> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    return listFor(this.prisma, card.id);
  }
}

// Owner first, then in the order people were assigned.
async function listFor(
  db: Prisma.TransactionClient,
  cardId: string,
): Promise<AssigneeWithPerson[]> {
  const rows = await db.cardAssignee.findMany({
    where: { cardId },
    include: {
      member: { select: { user: { select: { id: true, displayName: true } } } },
    },
    orderBy: [{ isOwner: 'desc' }, { assignedAt: 'asc' }, { userId: 'asc' }],
  });
  return rows.map(({ member, ...assignee }) => ({
    ...assignee,
    user: member.user,
  }));
}
