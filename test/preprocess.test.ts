import { describe, expect, it } from 'vitest';
import { preprocessMessage } from '../src/messages/preprocess.js';

const mentions = {
  user: (id: string) => (id === '1' ? 'Ada' : undefined),
  channel: (id: string) => (id === '2' ? 'general' : undefined),
  role: (id: string) => (id === '3' ? 'mods' : undefined)
};

describe('preprocessMessage', () => {
  it('replaces URLs without reading them character by character', () => {
    expect(preprocessMessage('see https://example.com/a?b=c', { maxLength: 200 })).toBe('see link');
  });

  it('resolves mentions and custom emoji', () => {
    expect(preprocessMessage('hi <@1> in <#2> <@&3> <:wave:123>', { maxLength: 200, mentions })).toBe('hi Ada in general mods wave');
  });

  it('speaks names for Unicode emoji', () => {
    expect(preprocessMessage('hi 🙂 🔥 🫠', { maxLength: 200 })).toBe('hi slightly smiling face fire emoji');
  });

  it('applies pronunciation replacements without recursive replacement', () => {
    expect(preprocessMessage('Ada met bot and botany', {
      maxLength: 200,
      pronunciations: [
        { fromText: 'Ada', toText: 'Ay-duh' },
        { fromText: 'Ay-duh', toText: 'should not happen' },
        { fromText: 'bot', toText: 'robot' }
      ]
    })).toBe('Ay-duh met robot and botany');
  });

  it('strips common markdown and code blocks', () => {
    expect(preprocessMessage('## **hello** `world`\n```ts\nconst x = 1\n```', { maxLength: 200 })).toBe('hello world code block');
  });

  it('collapses repeated punctuation', () => {
    expect(preprocessMessage('what????!!!!', { maxLength: 200 })).toBe('what???');
  });

  it('returns undefined for empty output', () => {
    expect(preprocessMessage('***', { maxLength: 200 })).toBeUndefined();
  });

  it('truncates long messages', () => {
    expect(preprocessMessage('1234567890', { maxLength: 5 })).toBe('12345...');
  });
});
