// Runs on the audio thread: the microphone at the call's rate, as 16-bit PCM in 40 ms chunks.
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

export class TalkCapture extends AudioWorkletProcessor {
  /** Microphone samples to each one sent. */
  private readonly step: number;
  private readonly chunk: Int16Array;
  private filled = 0;
  private squares = 0;
  private sum = 0;
  private count = 0;
  private due = 0;

  constructor(options: { processorOptions: { rate: number } }) {
    super(options);
    const { rate } = options.processorOptions;
    this.step = Math.max(1, sampleRate / rate);
    this.chunk = new Int16Array(Math.round(rate * 0.04));
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    // Each sample sent averages those it stands for: enough of a low-pass for speech.
    for (const sample of input) {
      this.sum += sample;
      this.count += 1;
      this.due += 1;
      if (this.due < this.step) continue;
      this.due -= this.step;
      const value = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.squares += value * value;
      this.chunk[this.filled++] = Math.round(value * 0x7fff);
      if (this.filled < this.chunk.length) continue;
      const pcm = this.chunk.slice();
      this.port.postMessage({ pcm, level: Math.sqrt(this.squares / pcm.length) }, [pcm.buffer]);
      this.filled = 0;
      this.squares = 0;
    }
    return true;
  }
}

registerProcessor("talk-capture", TalkCapture);
