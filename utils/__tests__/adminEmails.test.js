import { ADMIN_EMAILS } from '../adminEmails';

describe('ADMIN_EMAILS', () => {
  test('is a non-empty array of valid admin email strings', () => {
    expect(Array.isArray(ADMIN_EMAILS)).toBe(true);
    expect(ADMIN_EMAILS.length).toBeGreaterThan(0);

    ADMIN_EMAILS.forEach((email) => {
      expect(typeof email).toBe('string');
      expect(email.length).toBeGreaterThan(0);
      expect(email.endsWith('@cornell.edu') || email.endsWith('@gmail.com')).toBe(true);
    });
  });
});
