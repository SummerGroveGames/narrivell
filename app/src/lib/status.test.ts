import { describe, expect, it } from 'vitest';
import { desktopPlatform, offlineCheck, storageCheck } from './status';

describe('desktopPlatform', () => {
  it('recognises Windows (WebView2)', () => {
    expect(
      desktopPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Edg/142.0'),
    ).toBe('Windows');
  });
  it('recognises Linux (WebKitGTK)', () => {
    expect(desktopPlatform('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBe(
      'Linux',
    );
  });
  it('recognises macOS', () => {
    expect(desktopPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15')).toBe('macOS');
  });
  it('falls back to a generic name', () => {
    expect(desktopPlatform('SomethingElse/1.0')).toBe('desktop');
  });
});

describe('storageCheck', () => {
  it('reports protected storage', () => {
    expect(storageCheck(true).state).toBe('ok');
  });
  it('reports storage that is not yet protected', () => {
    expect(storageCheck(false).state).toBe('pending');
  });
  it('reports browsers without the storage API', () => {
    expect(storageCheck(null).state).toBe('unavailable');
  });
});

describe('offlineCheck', () => {
  it('is ok once the service worker is ready', () => {
    expect(offlineCheck(true, true).state).toBe('ok');
  });
  it('is pending while installing', () => {
    expect(offlineCheck(false, true).state).toBe('pending');
  });
  it('is unavailable without service worker support', () => {
    expect(offlineCheck(false, false).state).toBe('unavailable');
  });
});
