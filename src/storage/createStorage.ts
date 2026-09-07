import { SqliteStorage } from './SqliteStorage.js';
import type { Storage } from './Storage.js';

export function createStorage(databaseUrl: string): Storage {
  if (databaseUrl.startsWith('sqlite:')) {
    return new SqliteStorage(databaseUrl);
  }

  throw new Error(`Unsupported DATABASE_URL: ${databaseUrl}`);
}
