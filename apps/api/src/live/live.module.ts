import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { LiveGateway } from './live.gateway.js';
import { LiveInterceptor } from './live.interceptor.js';
import { LiveService } from './live.service.js';

// Live updates: the Socket.IO connection and the signals sent after saves.
@Module({
  imports: [AuthModule],
  providers: [
    LiveService,
    LiveGateway,
    { provide: APP_INTERCEPTOR, useClass: LiveInterceptor },
  ],
})
export class LiveModule {}
