import { describe, expect, it } from 'vitest';
import { CONTACT, contactLink } from './contact';

describe('contactLink', () => {
  it('addresses each Help item correctly', () => {
    expect(contactLink('featureRequest', '0.0.1', 'Windows')).toMatch(/^mailto:featurerequest@narrivell\.com\?/);
    expect(contactLink('feedback', '0.0.1', 'Linux')).toMatch(/^mailto:feedback@narrivell\.com\?/);
    expect(contactLink('support', '0.0.1', 'Linux')).toMatch(/^mailto:support@narrivell\.com\?/);
  });
  it('includes the version and system in the body, safely encoded', () => {
    const link = contactLink('feedback', '0.0.1', 'Linux & friends');
    const body = decodeURIComponent(new URL(link).searchParams.get('body') ?? '');
    expect(body).toContain('Narrivell version: 0.0.1');
    expect(body).toContain('System: Linux & friends');
    expect(link).not.toContain('&friends');
  });
  it('only ever uses mailto links', () => {
    for (const address of Object.values(CONTACT)) expect(address).toMatch(/^[a-z]+@[a-z.]+$/);
  });
});
