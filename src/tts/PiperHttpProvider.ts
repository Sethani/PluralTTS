import { Readable } from 'node:stream';
import type { TtsVoice } from '../types.js';
import type { TtsAudio, TtsProvider, TtsRequest } from './TtsProvider.js';
import { InvalidAudioError } from './errors.js';

export class PiperHttpProvider implements TtsProvider {
  private readonly voicesUrl: string;
  private readonly synthesizeUrl: string;

  constructor(url: string, private readonly timeoutMs: number) {
    const baseUrl = url.replace(/\/$/, '').replace(/\/synthesize$/, '');
    this.voicesUrl = `${baseUrl}/voices`;
    this.synthesizeUrl = `${baseUrl}/synthesize`;
  }

  async listVoices(): Promise<TtsVoice[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.voicesUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Piper HTTP voices failed with ${response.status}`);
      }

      const data = (await response.json()) as { voices?: TtsVoice[] };
      return (data.voices ?? []).map((voice) => ({
        id: voice.id,
        label: voice.label ?? voice.id,
        language: voice.language,
        gender: voice.gender
      }));
    } finally {
      clearTimeout(timeout);
    }
  }

  async synthesize(request: TtsRequest): Promise<TtsAudio> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.synthesizeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: request.text,
          voiceId: request.voiceId,
          speed: request.speed
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Piper HTTP synthesis failed with ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength === '0') {
        throw new InvalidAudioError('Piper HTTP synthesis returned an empty audio response');
      }

      if (!response.body) {
        throw new InvalidAudioError('Piper HTTP synthesis returned an empty audio response');
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!isAudioContentType(contentType)) {
        const preview = await response.text().catch(() => '');
        throw new InvalidAudioError(`Piper HTTP synthesis returned ${contentType || 'unknown content type'}${preview ? `: ${preview.slice(0, 120)}` : ''}`);
      }

      return { stream: Readable.fromWeb(response.body) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isAudioContentType(contentType: string): boolean {
  return contentType.startsWith('audio/') || contentType.startsWith('application/octet-stream');
}
