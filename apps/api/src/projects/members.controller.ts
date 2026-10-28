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
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import {
  type MemberChanges,
  memberChangesSchema,
  type NewMember,
  newMemberSchema,
} from './members.schemas.js';
import { MembersService, type MemberView } from './members.service.js';

@Controller('projects/:projectId/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(
    @CurrentUser() user: SignedInUser,
    @Param('projectId', IdParam) projectId: string,
  ): Promise<MemberView[]> {
    return this.members.listMembers(user.id, projectId);
  }

  @Post()
  add(
    @CurrentUser() user: SignedInUser,
    @Param('projectId', IdParam) projectId: string,
    @Body(new ZodPipe(newMemberSchema)) body: NewMember,
  ): Promise<MemberView> {
    return this.members.addMember(user.id, projectId, body);
  }

  @Patch(':userId')
  change(
    @CurrentUser() user: SignedInUser,
    @Param('projectId', IdParam) projectId: string,
    @Param('userId', IdParam) memberId: string,
    @Body(new ZodPipe(memberChangesSchema)) body: MemberChanges,
  ): Promise<MemberView> {
    return this.members.changeRole(user.id, projectId, memberId, body);
  }

  // Removes someone, or leaves the project when it is your own id.
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: SignedInUser,
    @Param('projectId', IdParam) projectId: string,
    @Param('userId', IdParam) memberId: string,
  ): Promise<void> {
    return this.members.removeMember(user.id, projectId, memberId);
  }
}
