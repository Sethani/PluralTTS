export interface MentionResolver {
  user(id: string): string | undefined;
  channel(id: string): string | undefined;
  role(id: string): string | undefined;
}

export interface PreprocessOptions {
  maxLength: number;
  mentions?: MentionResolver;
  pronunciations?: Array<{ fromText: string; toText: string }>;
}

export function preprocessMessage(input: string, options: PreprocessOptions): string | undefined {
  let text = input;

  text = text.replace(/```[\s\S]*?```/g, ' code block ');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/\|\|([^|]+)\|\|/g, ' spoiler ');
  text = text.replace(/https?:\/\/\S+|www\.\S+/gi, ' link ');
  text = text.replace(/<a?:([A-Za-z0-9_~.-]+):\d+>/g, ' $1 ');
  text = replaceUnicodeEmoji(text);
  text = text.replace(/<@!?(\d+)>/g, (_, id: string) => ` ${options.mentions?.user(id) ?? 'someone'} `);
  text = text.replace(/<#(\d+)>/g, (_, id: string) => ` ${options.mentions?.channel(id) ?? 'channel'} `);
  text = text.replace(/<@&(\d+)>/g, (_, id: string) => {
    const role = options.mentions?.role(id);
    return role ? ` ${role} ` : ' ';
  });
  text = text.replace(/^#{1,3}\s+/gm, '');
  text = text.replace(/[*_~>#]/g, '');
  text = text.replace(/[!?.,;:]{4,}/g, (match) => match.slice(0, 3));
  text = text.replace(/\s+/g, ' ').trim();
  text = applyPronunciations(text, options.pronunciations ?? []);

  if (!text) {
    return undefined;
  }

  if (text.length > options.maxLength) {
    text = `${text.slice(0, options.maxLength).trimEnd()}...`;
  }

  return text;
}

function replaceUnicodeEmoji(input: string): string {
  return input.replace(emojiRegex, (emoji) => ` ${unicodeEmojiNames[emoji] ?? 'emoji'} `);
}

export function applyPronunciations(input: string, entries: Array<{ fromText: string; toText: string }>): string {
  let text = input;
  const replacements: string[] = [];

  for (const entry of entries) {
    const from = entry.fromText.trim();
    const to = entry.toText.trim();
    if (!from || !to) {
      continue;
    }

    const index = replacements.push(to) - 1;
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(from)}(?![\\p{L}\\p{N}])`, 'giu'), `\u0000${index}\u0000`);
  }

  for (const [index, replacement] of replacements.entries()) {
    text = text.replaceAll(`\u0000${index}\u0000`, replacement);
  }

  return text.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const unicodeEmojiNames: Record<string, string> = {
  '😀': 'grinning face',
  '😃': 'grinning face',
  '😄': 'smiling face',
  '😁': 'beaming face',
  '😆': 'laughing face',
  '😅': 'nervous laugh',
  '😂': 'laughing',
  '🤣': 'rolling on the floor laughing',
  '🙂': 'slightly smiling face',
  '🙃': 'upside down face',
  '😉': 'winking face',
  '😊': 'smiling face',
  '😇': 'innocent face',
  '🥰': 'smiling face with hearts',
  '😍': 'heart eyes',
  '😘': 'blowing a kiss',
  '😋': 'playful face',
  '😎': 'cool face',
  '🤔': 'thinking face',
  '🤨': 'skeptical face',
  '😐': 'neutral face',
  '😑': 'expressionless face',
  '😶': 'silent face',
  '🙄': 'rolling eyes',
  '😬': 'grimacing face',
  '😮': 'surprised face',
  '😲': 'astonished face',
  '🥺': 'pleading face',
  '😢': 'crying face',
  '😭': 'loudly crying face',
  '😤': 'triumphant face',
  '😠': 'angry face',
  '😡': 'angry face',
  '🤯': 'mind blown',
  '😳': 'flushed face',
  '🥳': 'partying face',
  '😴': 'sleeping face',
  '🤝': 'handshake',
  '👍': 'thumbs up',
  '👎': 'thumbs down',
  '👏': 'clapping hands',
  '🙏': 'folded hands',
  '❤️': 'red heart',
  '❤': 'red heart',
  '🧡': 'orange heart',
  '💛': 'yellow heart',
  '💚': 'green heart',
  '💙': 'blue heart',
  '💜': 'purple heart',
  '🖤': 'black heart',
  '🤍': 'white heart',
  '✨': 'sparkles',
  '⭐': 'star',
  '🔥': 'fire',
  '💀': 'skull',
  '🎉': 'party popper',
  '✅': 'check mark',
  '❌': 'cross mark'
};

const emojiRegex = /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?/gu;
