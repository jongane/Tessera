import { Module } from '@nestjs/common';
import { LabelsService } from './labels.service.js';

@Module({
  providers: [LabelsService],
  exports: [LabelsService],
})
export class LabelsModule {}
