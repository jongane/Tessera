import { BadRequestException, Injectable } from '@nestjs/common';
import type { CardAssignee, Prisma, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { findVisibleCard } from './card-access.js';

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
        await tx.cardAssignee.create({
          data: {
            cardId: card.id,
            projectId: card.projectId,
            userId: assigneeId,
            isOwner: current.length === 0,
          },
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
      // Clear the old owner first: the database allows only one at a time.
      await tx.cardAssignee.updateMany({
        where: { cardId: card.id, isOwner: true },
        data: { isOwner: false },
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

// Holds the card's row until the transaction ends, so two changes to the
// same card's assignees run one after the other. Without it, two people
// assigned at the same moment could both become the owner.
async function lockCard(
  tx: Prisma.TransactionClient,
  cardId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM cards WHERE id = ${cardId}::uuid FOR UPDATE`;
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
