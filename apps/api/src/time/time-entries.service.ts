import { Injectable } from '@nestjs/common';
import type { TimeEntry, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { findVisibleCard } from '../cards/card-access.js';
import { findChangeableEntry } from './time-access.js';
import { requireEntryMinutes, requireWorkDate } from './time-input.js';

export interface NewTimeEntry {
  minutes: number;
  // The day the work was done, as YYYY-MM-DD.
  workDate: string;
  note?: string;
}

export interface TimeEntryChanges {
  minutes?: number;
  workDate?: string;
  // Null removes the note.
  note?: string | null;
}

export type TimeEntryWithPerson = TimeEntry & {
  user: Pick<User, 'id' | 'displayName'>;
};

// Time typed in by hand (docs/card-features.md, section 6). Timer entries
// are made by TimerService. Any member can log time and see everyone's.
@Injectable()
export class TimeEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async logTime(
    userId: string,
    cardId: string,
    entry: NewTimeEntry,
  ): Promise<TimeEntry> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    return this.prisma.timeEntry.create({
      data: {
        projectId: card.projectId,
        cardId: card.id,
        userId,
        minutes: requireEntryMinutes(entry.minutes),
        workDate: requireWorkDate(entry.workDate, new Date()),
        note: entry.note,
      },
    });
  }

  // Every entry on the card, latest day first.
  async listEntries(
    userId: string,
    cardId: string,
  ): Promise<TimeEntryWithPerson[]> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    return this.prisma.timeEntry.findMany({
      where: { cardId: card.id },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // Also clears the entry's review flag (see TimerService.stopTimer).
  async updateEntry(
    userId: string,
    entryId: string,
    changes: TimeEntryChanges,
  ): Promise<TimeEntry> {
    const entry = await findChangeableEntry(this.prisma, userId, entryId);
    return this.prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        minutes:
          changes.minutes === undefined
            ? undefined
            : requireEntryMinutes(changes.minutes),
        workDate:
          changes.workDate === undefined
            ? undefined
            : requireWorkDate(changes.workDate, new Date()),
        note: changes.note,
        // Any edit, even one that changes nothing, confirms the entry.
        needsReview: false,
      },
    });
  }

  async deleteEntry(userId: string, entryId: string): Promise<void> {
    const entry = await findChangeableEntry(this.prisma, userId, entryId);
    await this.prisma.timeEntry.delete({ where: { id: entry.id } });
  }
}
