import { describe, expect, it } from 'vitest';
import { isCronRequest } from '../lib/cron';

describe('daily sweep cron', () => {
  it('accepts only the exact bearer secret', () => {
    expect(isCronRequest('Bearer s3cret', 's3cret')).toBe(true);
    expect(isCronRequest('Bearer wrong', 's3cret')).toBe(false);
    expect(isCronRequest(null, 's3cret')).toBe(false);
    expect(isCronRequest('Bearer ', undefined)).toBe(false);
  });
});
