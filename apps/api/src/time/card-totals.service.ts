import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { type CardTotals, loadTreeTimes, rollUp } from './card-totals.js';
import { findVisibleCard } from '../cards/card-access.js';

// A card's estimate and time totals, rolled up from its subtasks.
@Injectable()
export class CardTotalsService {
  constructor(private readonly prisma: PrismaService) {}

  async totals(userId: string, cardId: string): Promise<CardTotals> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    return rollUp(await loadTreeTimes(this.prisma, card.id), card.id);
  }
}
