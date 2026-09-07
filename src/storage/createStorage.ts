import { SqliteStorage } from './SqliteStorage.js';
import { PgStorage } from './PgStorage.js';
import type { Storage } from './Storage.js';

export function createStorage(databaseUrl: string): Storage {
  if (databaseUrl.startsWith('sqlite:')) {
    return new SqliteStorage(databaseUrl);
  }

  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    return new PgStorage(databaseUrl);
  }

  throw new Error(`Unsupported DATABASE_URL: ${databaseUrl}`);
}
