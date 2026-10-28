import { Injectable } from '@nestjs/common';
import type { Prisma, TimeEntry, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { findVisibleCard } from '../cards/card-access.js';
import { findChangeableEntry } from './time-access.js';
import { requireEntryMinutes, requireWorkDate } from './time-input.js';
import {
  personRef,
  recordActivity,
  timeEntryRef,
} from '../activity/activity.js';

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
    const minutes = requireEntryMinutes(entry.minutes);
    const workDate = requireWorkDate(entry.workDate, new Date());
    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.timeEntry.create({
        data: {
          projectId: card.projectId,
          cardId: card.id,
          userId,
          minutes,
          workDate,
          note: entry.note,
        },
      });
      await recordTimeLogged(tx, saved, userId, false);
      return saved;
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
    const minutes =
      changes.minutes === undefined
        ? undefined
        : requireEntryMinutes(changes.minutes);
    const workDate =
      changes.workDate === undefined
        ? undefined
        : requireWorkDate(changes.workDate, new Date());
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM time_entries WHERE id = ${entry.id}::uuid FOR UPDATE`;
      const before = await tx.timeEntry.findUniqueOrThrow({
        where: { id: entry.id },
      });
      const after = await tx.timeEntry.update({
        where: { id: entry.id },
        data: {
          minutes,
          workDate,
          note: changes.note,
          // Any edit, even one that changes nothing, confirms the entry.
          needsReview: false,
        },
      });
      const from = timeEntryRef(before);
      const to = timeEntryRef(after);
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        await recordActivity(tx, cardOf(after), userId, 'TIME_ENTRY_EDITED', {
          entryId: after.id,
          user: await personRef(tx, after.userId),
          from,
          to,
        });
      }
      return after;
    });
  }

  async deleteEntry(userId: string, entryId: string): Promise<void> {
    const entry = await findChangeableEntry(this.prisma, userId, entryId);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.timeEntry.deleteMany({
        where: { id: entry.id },
      });
      if (removed.count > 0) {
        await recordActivity(tx, cardOf(entry), userId, 'TIME_ENTRY_DELETED', {
          entryId: entry.id,
          user: await personRef(tx, entry.userId),
          ...timeEntryRef(entry),
        });
      }
    });
  }
}

// Writes the TIME_LOGGED line for a new entry, typed in or from the timer.
export async function recordTimeLogged(
  tx: Prisma.TransactionClient,
  entry: TimeEntry,
  actorId: string,
  fromTimer: boolean,
): Promise<void> {
  await recordActivity(tx, cardOf(entry), actorId, 'TIME_LOGGED', {
    entryId: entry.id,
    user: await personRef(tx, entry.userId),
    fromTimer,
    ...timeEntryRef(entry),
  });
}

function cardOf(entry: TimeEntry): { id: string; projectId: string } {
  return { id: entry.cardId, projectId: entry.projectId };
}
