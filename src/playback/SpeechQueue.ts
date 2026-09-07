import { EventEmitter } from 'node:events';
import type { QueuedSpeech } from '../types.js';

export type SpeechQueueEvents = {
  item: [QueuedSpeech];
  dropped: [QueuedSpeech];
};

export class SpeechQueue extends EventEmitter {
  private readonly items: QueuedSpeech[] = [];
  private current: QueuedSpeech | undefined;

  constructor(private readonly maxLength: number) {
    super();
  }

  enqueue(item: QueuedSpeech): boolean {
    if (this.items.length >= this.maxLength) {
      this.emit('dropped', item);
      return false;
    }

    this.items.push(item);
    this.emit('item', item);
    return true;
  }

  next(): QueuedSpeech | undefined {
    this.current = this.items.shift();
    return this.current;
  }

  peek(): QueuedSpeech | undefined {
    return this.items[0];
  }

  clear(): number {
    const count = this.items.length;
    this.items.length = 0;
    return count;
  }

  get length(): number {
    return this.items.length;
  }

  get currentItem(): QueuedSpeech | undefined {
    return this.current;
  }
}
