import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type NewTimeEntryBody,
  newTimeEntrySchema,
  type StartTimerBody,
  startTimerSchema,
  type TimeEntryChangesBody,
  timeEntryChangesSchema,
} from '@tessera/shared';
import type { RunningTimer, TimeEntry } from '../generated/prisma/client.js';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import type { CardTotals } from './card-totals.js';
import { CardTotalsService } from './card-totals.service.js';
import {
  TimeEntriesService,
  type TimeEntryWithPerson,
} from './time-entries.service.js';
import { type StartTimerResult, TimerService } from './timer.service.js';

@Controller()
export class TimeController {
  constructor(
    private readonly entries: TimeEntriesService,
    private readonly timer: TimerService,
    private readonly totals: CardTotalsService,
  ) {}

  // Everyone's time on the card, latest day first.
  @Get('cards/:cardId/time-entries')
  list(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
  ): Promise<TimeEntryWithPerson[]> {
    return this.entries.listEntries(user.id, cardId);
  }

  @Post('cards/:cardId/time-entries')
  log(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Body(new ZodPipe(newTimeEntrySchema)) body: NewTimeEntryBody,
  ): Promise<TimeEntry> {
    return this.entries.logTime(user.id, cardId, body);
  }

  // Your own entries for 24 hours after logging them; admins any entry.
  @Patch('time-entries/:entryId')
  change(
    @CurrentUser() user: SignedInUser,
    @Param('entryId', IdParam) entryId: string,
    @Body(new ZodPipe(timeEntryChangesSchema))
    body: TimeEntryChangesBody,
  ): Promise<TimeEntry> {
    return this.entries.updateEntry(user.id, entryId, body);
  }

  @Delete('time-entries/:entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: SignedInUser,
    @Param('entryId', IdParam) entryId: string,
  ): Promise<void> {
    return this.entries.deleteEntry(user.id, entryId);
  }

  // Estimate and time spent, rolled up from the card's subtasks.
  @Get('cards/:cardId/time-totals')
  cardTotals(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
  ): Promise<CardTotals> {
    return this.totals.totals(user.id, cardId);
  }

  // 409 with `runningCardId` when your timer runs on another card, unless
  // stopRunning is true.
  @Post('cards/:cardId/timer')
  startTimer(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Body(new ZodPipe(startTimerSchema)) body: StartTimerBody,
  ): Promise<StartTimerResult> {
    return this.timer.startTimer(user.id, cardId, body);
  }

  // Your running timer, if any.
  @Get('timer')
  async runningTimer(
    @CurrentUser() user: SignedInUser,
  ): Promise<{ timer: RunningTimer | null }> {
    return { timer: await this.timer.runningTimer(user.id) };
  }

  // Stops your timer. `entry` is the time saved, or null when it ran for
  // under half a minute.
  @Delete('timer')
  async stopTimer(
    @CurrentUser() user: SignedInUser,
  ): Promise<{ entry: TimeEntry | null }> {
    return { entry: await this.timer.stopTimer(user.id) };
  }
}
