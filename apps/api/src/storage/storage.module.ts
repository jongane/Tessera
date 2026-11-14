import { Global, Module } from '@nestjs/common';
import { FILE_STORE } from './file-store.js';
import { S3FileStore } from './s3-file-store.js';
import { readFileSizeLimit, readStorageSettings } from './storage-settings.js';

// The size limit is read once at start, like the storage settings.
export const FILE_SIZE_LIMIT = Symbol('FILE_SIZE_LIMIT');

@Global()
@Module({
  providers: [
    {
      provide: FILE_STORE,
      // Reads the settings and makes the bucket when the API starts. A
      // missing setting stops the start here, naming it.
      useFactory: async () => {
        const store = new S3FileStore(readStorageSettings(process.env));
        await store.ensureBucket();
        return store;
      },
    },
    {
      provide: FILE_SIZE_LIMIT,
      useFactory: () => readFileSizeLimit(process.env),
    },
  ],
  exports: [FILE_STORE, FILE_SIZE_LIMIT],
})
export class StorageModule {}
