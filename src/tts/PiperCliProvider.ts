import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Logger } from 'pino';
import type { TtsVoice } from '../types.js';
import type { TtsAudio, TtsProvider, TtsRequest } from './TtsProvider.js';
import { InvalidAudioError } from './errors.js';

export interface PiperCliProviderOptions {
  bin: string;
  voicesDir: string;
  timeoutMs: number;
  logger: Logger;
}

export class PiperCliProvider implements TtsProvider {
  constructor(private readonly options: PiperCliProviderOptions) {}

  async listVoices(): Promise<TtsVoice[]> {
    const files = await readdir(this.options.voicesDir, { recursive: true });
    const voices = files
      .filter((file) => typeof file === 'string' && file.endsWith('.onnx'))
      .map((file) => {
        const id = path.basename(file, '.onnx');
        return { id, label: id };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    return voices;
  }

  async synthesize(request: TtsRequest): Promise<TtsAudio> {
    const workDir = await mkdtemp(path.join(tmpdir(), 'plural-tts-'));
    const outputFile = path.join(workDir, 'speech.wav');
    const modelFile = path.join(this.options.voicesDir, `${request.voiceId}.onnx`);
    const lengthScale = request.speed ? String(1 / request.speed) : undefined;
    const args = ['--model', modelFile, '--output_file', outputFile];

    if (lengthScale) {
      args.push('--length_scale', lengthScale);
    }

    await runPiper(this.options.bin, args, request.text, this.options.timeoutMs, this.options.logger);
    const output = await stat(outputFile).catch(() => undefined);
    if (!output || output.size <= 44) {
      await rm(workDir, { recursive: true, force: true });
      throw new InvalidAudioError(`Piper CLI returned invalid audio for voice ${request.voiceId}`);
    }

    return {
      stream: createReadStream(outputFile),
      cleanup: async () => {
        await rm(workDir, { recursive: true, force: true });
      }
    };
  }
}

function runPiper(bin: string, args: string[], text: string, timeoutMs: number, logger: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Piper timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      logger.warn({ code, stderr }, 'Piper synthesis failed');
      reject(new Error(`Piper exited with code ${code}`));
    });

    child.stdin.end(text);
  });
}
