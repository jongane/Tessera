import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FILE_STORE, type FileStore } from '../storage/file-store.js';

const HOUR_MS = 3_600_000;
// A pending file that is never sent is deleted after this long.
const PENDING_MAX_AGE_MS = 24 * HOUR_MS;

// Deletes pending files (uploaded into a message box, never sent) that are
// older than 24 hours: the row first, then the object. It runs when the API
// starts and then every hour. A file being sent at that moment is either sent
// or swept: the delete waits for the sender's lock and then no longer sees a
// pending row.
@Injectable()
export class PendingFileSweep
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly log = new Logger(PendingFileSweep.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORE) private readonly store: FileStore,
  ) {}

  onApplicationBootstrap(): void {
    this.runAndLog();
    this.timer = setInterval(() => this.runAndLog(), HOUR_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - PENDING_MAX_AGE_MS);
    const swept = await this.prisma.$queryRaw<{ storage_key: string }[]>`
      DELETE FROM files
      WHERE pending_chat_id IS NOT NULL AND created_at < ${cutoff}::timestamptz
      RETURNING storage_key`;
    for (const { storage_key } of swept) {
      await this.deleteObject(storage_key);
    }
  }

  private runAndLog(): void {
    this.run(new Date()).catch((error: unknown) =>
      this.log.error(`Pending file sweep failed: ${String(error)}`),
    );
  }

  private async deleteObject(storageKey: string): Promise<void> {
    try {
      await this.store.delete(storageKey);
    } catch (error) {
      this.log.error(
        `Could not delete the stored file ${storageKey}: ${String(error)}`,
      );
    }
  }
}
