import type { Readable } from 'node:stream';
import type { TtsVoice } from '../types.js';

export interface TtsRequest {
  text: string;
  voiceId: string;
  speed?: number;
  style?: string;
}

export interface TtsAudio {
  stream: Readable;
  cleanup?: () => Promise<void> | void;
}

export interface TtsProvider {
  synthesize(request: TtsRequest): Promise<TtsAudio>;
  listVoices(): Promise<TtsVoice[]>;
}
