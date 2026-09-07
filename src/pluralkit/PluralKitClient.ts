import type { Logger } from 'pino';
import type { Speaker } from '../types.js';

interface PluralKitMessageResponse {
  id: string;
  original?: string | null;
  sender?: string | null;
  member?: {
    id?: string | null;
    uuid?: string | null;
    name?: string | null;
    display_name?: string | null;
  } | null;
}

export interface PluralKitLookup {
  proxyMessageId: string;
  originalMessageId?: string;
  senderId?: string;
  speaker: Speaker;
}

export class PluralKitClient {
  private readonly cache = new Map<string, PluralKitLookup | null>();
  private blockedUntil = 0;

  constructor(
    private readonly options: {
      apiBase: string;
      userAgent: string;
      timeoutMs: number;
      onFailure?: (guildId?: string) => void;
      logger: Logger;
    }
  ) {}

  async lookupMessage(messageId: string, guildId?: string): Promise<PluralKitLookup | null> {
    if (this.cache.has(messageId)) {
      return this.cache.get(messageId) ?? null;
    }

    if (Date.now() < this.blockedUntil) {
      this.options.logger.debug({ messageId, blockedUntil: this.blockedUntil }, 'Skipping PluralKit lookup during rate-limit backoff');
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(`${this.options.apiBase}/messages/${messageId}`, {
        headers: { 'user-agent': this.options.userAgent },
        signal: controller.signal
      });

      if (response.status === 404) {
        this.cache.set(messageId, null);
        return null;
      }

      if (response.status === 429) {
        this.blockedUntil = Date.now() + retryAfterMs(response.headers.get('retry-after'));
        throw new Error(`PluralKit lookup rate-limited until ${new Date(this.blockedUntil).toISOString()}`);
      }

      if (!response.ok) {
        throw new Error(`PluralKit lookup failed with ${response.status}`);
      }

      const data = (await response.json()) as PluralKitMessageResponse;
      const memberId = data.member?.uuid ?? data.member?.id;

      if (!memberId) {
        this.cache.set(messageId, null);
        return null;
      }

      const lookup: PluralKitLookup = {
        proxyMessageId: data.id,
        originalMessageId: data.original ?? undefined,
        senderId: data.sender ?? undefined,
        speaker: {
          id: `pluralkit_member:${memberId}`,
          kind: 'pluralkit_member',
          displayName: data.member?.display_name ?? data.member?.name ?? 'PluralKit member'
        }
      };

      this.cache.set(messageId, lookup);
      if (lookup.originalMessageId) {
        this.cache.set(lookup.originalMessageId, lookup);
      }

      return lookup;
    } catch (error) {
      this.options.onFailure?.(guildId);
      this.options.logger.warn({ error, messageId }, 'PluralKit lookup failed');
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function retryAfterMs(header: string | null): number {
  if (!header) {
    return 10_000;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(1_000, seconds * 1000);
  }

  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : 10_000;
}
