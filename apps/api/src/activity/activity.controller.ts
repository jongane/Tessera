import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { type ActivityPage, ActivityService } from './activity.service.js';

const activityQuerySchema = z.strictObject({
  // 1 to 100 lines per page; 50 when left out.
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // The `nextBefore` of the previous page.
  before: z.string().max(20).optional(),
});

@Controller('cards/:cardId/activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  // The card's history for the Activity tab, newest first.
  @Get()
  list(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Query(new ZodPipe(activityQuerySchema))
    query: z.infer<typeof activityQuerySchema>,
  ): Promise<ActivityPage> {
    return this.activity.listActivity(user.id, cardId, query);
  }
}
