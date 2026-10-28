import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/signed-in-user.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // A quick check that the API is running. Needs no sign-in.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
