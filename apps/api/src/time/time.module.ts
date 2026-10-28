import { Module } from '@nestjs/common';
import { TimeController } from './time.controller.js';
import { CardTotalsService } from './card-totals.service.js';
import { TimeEntriesService } from './time-entries.service.js';
import { TimerService } from './timer.service.js';

@Module({
  controllers: [TimeController],
  providers: [CardTotalsService, TimeEntriesService, TimerService],
  exports: [CardTotalsService, TimeEntriesService, TimerService],
})
export class TimeModule {}
