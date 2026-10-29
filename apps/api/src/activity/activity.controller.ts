import { Controller, Get, Param, Query } from '@nestjs/common';
import { type ActivityQuery, activityQuerySchema } from '@tessera/shared';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { type ActivityPage, ActivityService } from './activity.service.js';

@Controller('cards/:cardId/activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  // The card's history for the Activity tab, newest first.
  @Get()
  list(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Query(new ZodPipe(activityQuerySchema))
    query: ActivityQuery,
  ): Promise<ActivityPage> {
    return this.activity.listActivity(user.id, cardId, query);
  }
}
