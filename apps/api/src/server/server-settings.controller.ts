import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import {
  CurrentUser,
  Public,
  type SignedInUser,
} from '../auth/signed-in-user.js';
import {
  type ServerSettingsChanges,
  serverSettingsChangesSchema,
} from '@tessera/shared';

export interface ServerSettingsView {
  signUpOpen: boolean;
}

// Settings for the whole server. Anyone can read them (the sign-up page
// needs to know whether sign-up is open); only a server admin can change
// them.
@Controller('server/settings')
export class ServerSettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async read(): Promise<ServerSettingsView> {
    const settings = await this.prisma.serverSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    return { signUpOpen: settings.signUpOpen };
  }

  @Patch()
  async change(
    @CurrentUser() user: SignedInUser,
    @Body(new ZodPipe(serverSettingsChangesSchema))
    body: ServerSettingsChanges,
  ): Promise<ServerSettingsView> {
    if (!user.isServerAdmin) {
      throw new ForbiddenException(
        'Only a server admin can change server settings',
      );
    }
    const settings = await this.prisma.serverSettings.update({
      where: { id: 1 },
      data: body,
    });
    return { signUpOpen: settings.signUpOpen };
  }
}
