import { Module } from '@nestjs/common';
import { ChecklistsService } from './checklists.service.js';

@Module({
  providers: [ChecklistsService],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
