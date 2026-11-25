import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { PendingFileSweep } from './pending-file-sweep.js';

@Module({
  controllers: [FilesController],
  providers: [FilesService, PendingFileSweep],
  exports: [FilesService],
})
export class FilesModule {}
