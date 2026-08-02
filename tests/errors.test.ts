import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/middleware/errors.js';

describe('HttpError', () => {
  it('retains the RFC 7807 fields used by the error middleware', () => {
    const error = new HttpError(422, 'Invalid transition', 'placed cannot transition to delivered');
    expect(error).toMatchObject({
      status: 422,
      title: 'Invalid transition',
      message: 'placed cannot transition to delivered',
      type: 'about:blank',
    });
  });
});
