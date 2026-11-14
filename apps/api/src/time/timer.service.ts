import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type RunningTimer,
  type TimeEntry,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { findVisibleCard } from '../cards/card-access.js';
import { projectTimeZone } from '../projects/project-access.js';
import { localDate, timerMinutes } from './time-input.js';
import { recordTimeLogged } from './time-entries.service.js';
import { retryOnCollision } from '../common/retry-on-collision.js';

export interface StartTimerOptions {
  // Go ahead even though a timer is running on another card: that timer
  // stops and its time is saved first.
  stopRunning?: boolean;
}

export interface StartTimerResult {
  timer: RunningTimer;
  // The entry saved from the timer that was stopped, if any.
  savedEntry: TimeEntry | null;
}

// The start/stop timer (docs/card-features.md, section 6). Each person has
// at most one running timer; stopping it saves an ordinary time entry.
@Injectable()
export class TimerService {
  constructor(private readonly prisma: PrismaService) {}

  // Starting a timer while another runs is refused with the running card's
  // id, so the screen can warn "This stops the timer on WEB-2".
  async startTimer(
    userId: string,
    cardId: string,
    options: StartTimerOptions = {},
  ): Promise<StartTimerResult> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    // Dated the day the timer starts in the project's time zone. Changing
    // the zone later does not change it.
    const workDate = localDate(
      new Date(),
      await projectTimeZone(this.prisma, card.projectId),
    );

    try {
      return await retryOnCollision(() =>
        this.prisma.$transaction(async (tx) => {
          const running = await tx.runningTimer.findUnique({
            where: { userId },
          });
          if (running?.cardId === card.id) {
            return { timer: running, savedEntry: null };
          }
          if (running && !options.stopRunning) {
            throw runningElsewhere(running.cardId);
          }
          const savedEntry = running ? await saveTimer(tx, running) : null;
          const timer = await tx.runningTimer.create({
            data: {
              userId,
              projectId: card.projectId,
              cardId: card.id,
              workDate,
            },
          });
          return { timer, savedEntry };
        }),
      );
    } catch (error) {
      // Two starts at the same moment: the database keeps only one.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A timer is already running');
      }
      throw error;
    }
  }

  // Stops the person's timer and saves its time. Returns null when it ran
  // for under half a minute, as there is nothing to save.
  async stopTimer(userId: string): Promise<TimeEntry | null> {
    return retryOnCollision(() =>
      this.prisma.$transaction(async (tx) => {
        const running = await tx.runningTimer.findUnique({ where: { userId } });
        if (!running) {
          throw new NotFoundException('No timer is running');
        }
        return saveTimer(tx, running);
      }),
    );
  }

  runningTimer(userId: string): Promise<RunningTimer | null> {
    return this.prisma.runningTimer.findUnique({ where: { userId } });
  }
}

// Removes the timer and saves its time as an entry dated the day it started.
// A timer left running over 24 hours saves 24 hours, flagged for review.
// If another request stopped it first, nothing is saved twice.
export async function saveTimer(
  tx: Prisma.TransactionClient,
  timer: RunningTimer,
): Promise<TimeEntry | null> {
  const removed = await tx.runningTimer.deleteMany({
    where: { userId: timer.userId, startedAt: timer.startedAt },
  });
  const endedAt = new Date();
  const { minutes, overLimit } = timerMinutes(timer.startedAt, endedAt);
  if (removed.count === 0 || minutes < 1) {
    return null;
  }
  const entry = await tx.timeEntry.create({
    data: {
      projectId: timer.projectId,
      cardId: timer.cardId,
      userId: timer.userId,
      workDate: timer.workDate,
      minutes,
      startedAt: timer.startedAt,
      endedAt,
      needsReview: overLimit,
    },
  });
  await recordTimeLogged(tx, entry, timer.userId, true);
  return entry;
}

function runningElsewhere(runningCardId: string): ConflictException {
  return new ConflictException({
    message:
      'A timer is already running on another card. Starting this one stops it.',
    runningCardId,
  });
}
