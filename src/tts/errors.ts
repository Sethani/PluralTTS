export class InvalidAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAudioError';
  }
}
