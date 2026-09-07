import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import { PiperCliProvider } from './PiperCliProvider.js';
import { PiperHttpProvider } from './PiperHttpProvider.js';
import type { TtsProvider } from './TtsProvider.js';

export function createTtsProvider(config: AppConfig): TtsProvider {
  if (config.tts.provider === 'piper-http') {
    if (!config.tts.piperUrl) {
      throw new Error('PIPER_URL is required when TTS_PROVIDER=piper-http');
    }

    return new PiperHttpProvider(config.tts.piperUrl, config.tts.timeoutMs);
  }

  return new PiperCliProvider({
    bin: config.tts.piperBin,
    voicesDir: config.tts.voicesDir,
    timeoutMs: config.tts.timeoutMs,
    logger
  });
}
