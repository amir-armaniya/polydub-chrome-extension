import { describe, expect, it } from 'vitest';
import { PlayQueue } from '../lib/play-queue';

describe('PlayQueue', () => {
  it('auto-starts playback when the first clip is enqueued', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    expect(q.snapshot).toEqual({ state: 'playing', index: 0, total: 1 });
    expect(q.currentClip).toBe('a');
  });

  it('advances to the next clip on ended and clears when finished', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    q.enqueue('b');
    expect(q.snapshot.total).toBe(2);
    q.onEnded();
    expect(q.snapshot).toEqual({ state: 'playing', index: 1, total: 2 });
    expect(q.currentClip).toBe('b');
    q.onEnded();
    expect(q.snapshot).toEqual({ state: 'idle', index: -1, total: 0 });
    expect(q.currentClip).toBeNull();
  });

  it('stop keeps the queue and preserves position; play resumes', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    q.enqueue('b');
    q.onEnded();
    q.stop();
    expect(q.snapshot).toEqual({ state: 'paused', index: 1, total: 2 });
    expect(q.currentClip).toBe('b');
    q.play();
    expect(q.snapshot.state).toBe('playing');
    expect(q.currentClip).toBe('b');
  });

  it('pause stops playback but keeps the current clip', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    q.pause();
    expect(q.snapshot).toEqual({ state: 'paused', index: 0, total: 1 });
  });

  it('clear empties the queue and resets to idle', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    q.enqueue('b');
    q.clear();
    expect(q.snapshot).toEqual({ state: 'idle', index: -1, total: 0 });
    expect(q.currentClip).toBeNull();
  });

  it('enqueue while paused keeps the paused state', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    q.pause();
    q.enqueue('b');
    expect(q.snapshot).toEqual({ state: 'paused', index: 0, total: 2 });
  });

  it('never exceeds maxClips; drops the oldest finished clip', () => {
    const q = new PlayQueue(2);
    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');
    expect(q.snapshot.total).toBe(2);
    expect(q.currentClip).toBe('b');
  });
});
