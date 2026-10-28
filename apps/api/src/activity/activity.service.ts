import { BadRequestException, Injectable } from '@nestjs/common';
import type { ActivityKind } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { findVisibleCard } from '../cards/card-access.js';
import type { PersonRef } from './activity.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export interface ActivityLine {
  id: string;
  kind: ActivityKind;
  // Shaped by kind; see ActivityDetails in activity.ts.
  details: unknown;
  // Null once the person has been deleted.
  actor: PersonRef | null;
  createdAt: Date;
}

export interface ActivityPage {
  items: ActivityLine[];
  // Pass as `before` to get the next (older) page; null when there is none.
  nextBefore: string | null;
}

export interface ActivityQuery {
  limit?: number;
  before?: string;
}

// Reads a card's history for the Activity tab. Every project member can see
// it. History is written by the services that make each change
// (recordActivity in activity.ts) and can never be changed afterwards.
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  // Newest first, a page at a time.
  async listActivity(
    userId: string,
    cardId: string,
    query: ActivityQuery = {},
  ): Promise<ActivityPage> {
    const limit = requirePageSize(query.limit ?? DEFAULT_PAGE_SIZE);
    const before =
      query.before === undefined ? undefined : requireCursor(query.before);
    const card = await findVisibleCard(this.prisma, userId, cardId);
    const rows = await this.prisma.cardActivity.findMany({
      where: { cardId: card.id, sequence: { lt: before } },
      orderBy: { sequence: 'desc' },
      take: limit + 1,
      include: { actor: { select: { id: true, displayName: true } } },
    });
    const items = rows.slice(0, limit);
    return {
      items: items.map((row) => ({
        id: row.id,
        kind: row.kind,
        details: row.details,
        actor: row.actor,
        createdAt: row.createdAt,
      })),
      nextBefore:
        rows.length > limit
          ? items[items.length - 1]!.sequence.toString()
          : null,
    };
  }
}

function requirePageSize(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new BadRequestException(
      `A page holds 1 to ${MAX_PAGE_SIZE} history lines`,
    );
  }
  return limit;
}

// The cursor is the `sequence` of the last line seen, sent as text because
// it can be larger than a JavaScript number holds exactly.
function requireCursor(before: string): bigint {
  if (!/^[0-9]{1,19}$/.test(before)) {
    throw new BadRequestException('Unknown page cursor');
  }
  return BigInt(before);
}
