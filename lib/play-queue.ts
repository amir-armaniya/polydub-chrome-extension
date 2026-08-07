export type QueueState = 'idle' | 'playing' | 'paused';

export interface QueueSnapshot {
  state: QueueState;
  index: number;
  total: number;
}

export class PlayQueue {
  private clips: string[] = [];
  private pos = 0;
  private state: QueueState = 'idle';
  private readonly maxClips: number;

  constructor(maxClips = 50) {
    this.maxClips = maxClips;
  }

  get snapshot(): QueueSnapshot {
    return { state: this.state, index: this.state === 'idle' ? -1 : this.pos, total: this.clips.length };
  }

  get currentClip(): string | null {
    if (this.state === 'idle' || this.pos >= this.clips.length) return null;
    return this.clips[this.pos];
  }

  enqueue(dataUrl: string): void {
    this.clips.push(dataUrl);
    while (this.clips.length > this.maxClips) {
      this.clips.shift();
      this.pos = Math.max(0, this.pos - 1);
    }
    if (this.state === 'idle' && this.clips.length > 0) {
      this.state = 'playing';
      this.pos = 0;
    }
  }

  play(): void {
    if (this.state === 'paused') {
      this.state = 'playing';
    } else if (this.state === 'idle' && this.clips.length > 0) {
      this.state = 'playing';
      this.pos = 0;
    }
  }

  pause(): void {
    if (this.state === 'playing') this.state = 'paused';
  }

  stop(): void {
    if (this.state === 'playing') this.state = 'paused';
  }

  clear(): void {
    this.clips = [];
    this.pos = 0;
    this.state = 'idle';
  }

  onEnded(): void {
    if (this.state === 'idle') return;
    if (this.pos + 1 < this.clips.length) {
      this.pos += 1;
      this.state = 'playing';
    } else {
      this.clips = [];
      this.pos = 0;
      this.state = 'idle';
    }
  }
}
