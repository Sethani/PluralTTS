export const metricKeys = [
  'messagesReceived',
  'messagesQueued',
  'messagesSpoken',
  'messagesSkipped',
  'messagesDropped',
  'messagesIgnored',
  'ttsFailures',
  'playbackFailures',
  'pluralKitLookupFailures',
  'invalidAudio',
  'reconnects'
] as const;

export type MetricKey = (typeof metricKeys)[number];
export type MetricSnapshot = Record<MetricKey, number>;

export class Metrics {
  private readonly guilds = new Map<string, MetricSnapshot>();

  increment(guildId: string, key: MetricKey, by = 1): void {
    const snapshot = this.snapshotForWrite(guildId);
    snapshot[key] += by;
  }

  snapshot(guildId: string): MetricSnapshot {
    return { ...this.snapshotForWrite(guildId) };
  }

  private snapshotForWrite(guildId: string): MetricSnapshot {
    const existing = this.guilds.get(guildId);
    if (existing) {
      return existing;
    }

    const snapshot = Object.fromEntries(metricKeys.map((key) => [key, 0])) as MetricSnapshot;
    this.guilds.set(guildId, snapshot);
    return snapshot;
  }
}
