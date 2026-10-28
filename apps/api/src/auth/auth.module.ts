import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { ServerSettingsController } from '../server/server-settings.controller.js';

@Module({
  controllers: [AuthController, ServerSettingsController],
  // APP_GUARD runs AuthGuard before every endpoint in the app.
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
