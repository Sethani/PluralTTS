import { describe, expect, it } from 'vitest';
import { SpeechQueue } from '../src/playback/SpeechQueue.js';
import type { QueuedSpeech } from '../src/types.js';

function item(id: string): QueuedSpeech {
  return {
    id,
    guildId: 'guild',
    text: id,
    speaker: { id: 'discord_user:1', kind: 'discord_user', displayName: 'Ada' },
    voiceId: 'voice',
    volume: 1,
    speed: 1,
    createdAt: Date.now()
  };
}

describe('SpeechQueue', () => {
  it('preserves FIFO order', () => {
    const queue = new SpeechQueue(3);
    queue.enqueue(item('a'));
    queue.enqueue(item('b'));

    expect(queue.peek()?.id).toBe('a');
    expect(queue.next()?.id).toBe('a');
    expect(queue.peek()?.id).toBe('b');
    expect(queue.next()?.id).toBe('b');
    expect(queue.next()).toBeUndefined();
  });

  it('drops new items when full', () => {
    const queue = new SpeechQueue(1);

    expect(queue.enqueue(item('a'))).toBe(true);
    expect(queue.enqueue(item('b'))).toBe(false);
    expect(queue.next()?.id).toBe('a');
  });

  it('clears pending items', () => {
    const queue = new SpeechQueue(3);
    queue.enqueue(item('a'));
    queue.enqueue(item('b'));

    expect(queue.clear()).toBe(2);
    expect(queue.length).toBe(0);
  });
});
