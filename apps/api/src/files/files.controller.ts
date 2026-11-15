import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { CardFile, CardFileList } from '@tessera/shared';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { contentDisposition } from './content-disposition.js';
import { FilesService } from './files.service.js';

const SAFE_HEADERS = { 'X-Content-Type-Options': 'nosniff' };

// Files on cards (docs/api.md, "Files"). Every byte goes through here: the
// storage is never reachable from the browser.
@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  // One file in the form field `file`, any project member.
  @Post('cards/:cardId/files')
  attach(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Req() req: Request,
  ): Promise<CardFile> {
    return this.files.attach(user, cardId, req);
  }

  @Get('cards/:cardId/files')
  list(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
  ): Promise<CardFileList> {
    return this.files.list(user, cardId);
  }

  // Always a download, whatever the file is, so nothing a person uploads can
  // run from this address.
  @Get('files/:fileId/download')
  async download(
    @CurrentUser() user: SignedInUser,
    @Param('fileId', IdParam) fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, body } = await this.files.open(user, fileId, false);
    res.set(SAFE_HEADERS);
    return new StreamableFile(body, {
      type: 'application/octet-stream',
      disposition: contentDisposition(file.name),
      length: Number(file.size),
    });
  }

  // Inline, and only for a PNG, JPEG, GIF or WebP the API recognised by its
  // first bytes. The policy stops anything in the file from running.
  @Get('files/:fileId/preview')
  async preview(
    @CurrentUser() user: SignedInUser,
    @Param('fileId', IdParam) fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, body } = await this.files.open(user, fileId, true);
    res.set({
      ...SAFE_HEADERS,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return new StreamableFile(body, {
      type: file.mimeType,
      length: Number(file.size),
    });
  }

  @Delete('files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: SignedInUser,
    @Param('fileId', IdParam) fileId: string,
  ): Promise<void> {
    return this.files.remove(user, fileId);
  }
}
