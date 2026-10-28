import { z } from 'zod';
import { ZodPipe } from './zod-pipe.js';

// Checks that an id in the URL is a UUID, so a typo gets 400 instead of a
// database error.
//   @Get(':cardId') find(@Param('cardId', IdParam) cardId: string)
export const IdParam = new ZodPipe(z.uuid('Not a valid id'));
