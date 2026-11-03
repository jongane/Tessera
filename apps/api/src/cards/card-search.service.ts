import { Injectable } from '@nestjs/common';
import type { CardSearchQuery, CardSearchResults } from '@tessera/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireMember } from '../projects/project-access.js';
import { boardsVisibleTo } from '../boards/board-access.js';
import {
  byNumber,
  formatCardNumber,
  isNumberPath,
  parseCardReference,
} from './card-number.js';

const DEFAULT_LIMIT = 20;

const withBoard = { board: { select: { name: true } } } as const;
type FoundCard = Prisma.CardGetPayload<{ include: typeof withBoard }>;
type CardSearchResult = CardSearchResults['cards'][number];

@Injectable()
export class CardSearchService {
  constructor(private readonly prisma: PrismaService) {}

  // Finds cards in the project by number (WEB-12, 12, an old number or an
  // old project code) or by words in their title, for example to pick a new
  // parent. Number matches come first: the card, then its subtasks.
  async search(
    userId: string,
    projectId: string,
    query: CardSearchQuery,
  ): Promise<CardSearchResults> {
    await requireMember(this.prisma, userId, projectId);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const inProject: Prisma.CardWhereInput = {
      projectId,
      board: boardsVisibleTo(userId),
    };
    const numberPath = await this.numberPathIn(projectId, query.q);
    const byNumberMatch = numberPath
      ? await this.findByNumber(inProject, numberPath, limit)
      : [];
    const byTitle = await this.prisma.card.findMany({
      where: {
        ...inProject,
        id: { notIn: byNumberMatch.map((card) => card.id) },
        title: { contains: escapeLike(query.q), mode: 'insensitive' },
      },
      include: withBoard,
      // When more match than fit, the newest are kept: they are most likely
      // what people are looking for. They are then put in number order.
      orderBy: { createdAt: 'desc' },
      take: Math.max(limit - byNumberMatch.length, 0),
    });
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { code: true },
    });
    return {
      cards: [...byNumberMatch, ...byTitle.sort(byNumber)].map((card) =>
        toResult(project.code, card),
      ),
    };
  }

  // The number path the search names, when it is a card number in this
  // project: "12.1", "WEB-12.1", or with one of the project's old codes.
  private async numberPathIn(
    projectId: string,
    q: string,
  ): Promise<string | null> {
    if (isNumberPath(q)) {
      return q.trim();
    }
    const reference = parseCardReference(q);
    if (!reference) {
      return null;
    }
    const code = await this.prisma.projectCode.findUnique({
      where: { code: reference.code },
      select: { projectId: true },
    });
    return code?.projectId === projectId ? reference.numberPath : null;
  }

  // The card with this number (or old number), then its subtasks at every
  // level, in number order.
  private async findByNumber(
    inProject: Prisma.CardWhereInput,
    numberPath: string,
    limit: number,
  ): Promise<FoundCard[]> {
    // A card's current number wins over another card's old one.
    const card =
      (await this.prisma.card.findFirst({
        where: { ...inProject, numberPath },
        include: withBoard,
      })) ??
      (await this.prisma.card.findFirst({
        where: { ...inProject, oldNumbers: { some: { numberPath } } },
        include: withBoard,
      }));
    if (!card) {
      return [];
    }
    const below = await this.prisma.card.findMany({
      where: {
        ...inProject,
        numberPath: { startsWith: `${card.numberPath}.` },
      },
      include: withBoard,
    });
    return [card, ...below.sort(byNumber)].slice(0, limit);
  }
}

function toResult(code: string, card: FoundCard): CardSearchResult {
  return {
    id: card.id,
    number: formatCardNumber(code, card.numberPath),
    title: card.title,
    boardId: card.boardId,
    boardName: card.board.name,
    isComplete: card.isComplete,
    depth: card.depth,
  };
}

// Prisma passes `contains` text into a LIKE pattern as it is, so % and _
// would match anything. A backslash makes them ordinary characters.
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
