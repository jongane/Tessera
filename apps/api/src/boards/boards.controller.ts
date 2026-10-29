import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Board, Column } from '../generated/prisma/client.js';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  type ColumnChanges,
  columnChangesSchema,
  type NewBoardBody,
  newBoardSchema,
} from '@tessera/shared';
import { BoardsService, type BoardView } from './boards.service.js';

@Controller()
export class BoardsController {
  constructor(
    private readonly boards: BoardsService,
    private readonly projects: ProjectsService,
  ) {}

  @Get('projects/:projectId/boards')
  async list(
    @CurrentUser() user: SignedInUser,
    @Param('projectId', IdParam) projectId: string,
  ): Promise<Board[]> {
    // An empty list would not tell a non-member apart from a project with
    // no boards, so check membership first.
    if (!(await this.projects.findProjectForUser(projectId, user.id))) {
      throw new NotFoundException('Project not found');
    }
    return this.boards.listBoardsForProject(user.id, projectId);
  }

  // A new board starts with To do, In progress and Done, and its general
  // thread.
  @Post('projects/:projectId/boards')
  create(
    @CurrentUser() user: SignedInUser,
    @Param('projectId', IdParam) projectId: string,
    @Body(new ZodPipe(newBoardSchema)) body: NewBoardBody,
  ): Promise<Board> {
    return this.boards.createBoard(user.id, projectId, body);
  }

  // The board with its columns and their cards.
  @Get('boards/:boardId')
  find(
    @CurrentUser() user: SignedInUser,
    @Param('boardId', IdParam) boardId: string,
  ): Promise<BoardView> {
    return this.boards.getBoardView(user.id, boardId);
  }

  @Patch('columns/:columnId')
  changeColumn(
    @CurrentUser() user: SignedInUser,
    @Param('columnId', IdParam) columnId: string,
    @Body(new ZodPipe(columnChangesSchema)) body: ColumnChanges,
  ): Promise<Column> {
    return this.boards.setColumnDone(user.id, columnId, body.isDone);
  }
}
