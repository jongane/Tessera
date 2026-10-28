import { Module } from '@nestjs/common';
import { CardTotalsService } from './card-totals.service.js';
import { TimeEntriesService } from './time-entries.service.js';
import { TimerService } from './timer.service.js';

@Module({
  providers: [CardTotalsService, TimeEntriesService, TimerService],
  exports: [CardTotalsService, TimeEntriesService, TimerService],
})
export class TimeModule {}
