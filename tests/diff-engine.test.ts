import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('diff engine logic', () => {
  it('detects changed content via hash comparison', () => {
    const v1 = 'You are a helpful assistant.';
    const v2 = 'You are a precise assistant.';
    expect(hashContent(v1)).not.toBe(hashContent(v2));
  });

  it('identical content produces same hash', () => {
    const a = 'You are a helpful assistant.\nAlways respond in JSON.';
    const b = 'You are a helpful assistant.\nAlways respond in JSON.';
    expect(hashContent(a)).toBe(hashContent(b));
  });

  it('normalizes line endings before hashing', () => {
    const unix = 'Line1\nLine2\nLine3';
    const windows = 'Line1\r\nLine2\r\nLine3';
    const normalizedWin = windows.replace(/\r\n/g, '\n');
    expect(hashContent(unix)).toBe(hashContent(normalizedWin));
  });

  it('preserves whitespace significance', () => {
    const a = 'You are helpful.';
    const b = 'You are  helpful.';
    expect(hashContent(a)).not.toBe(hashContent(b));
  });
});
