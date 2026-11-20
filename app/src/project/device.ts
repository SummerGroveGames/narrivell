/** This computer's identity for sync, versions and the activity log (no personal data). */
const KEY = 'narrivell.device';

export interface Device {
  id: string;
  name: string;
}

export function thisDevice(): Device {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Device | null;
    if (saved && /^[a-z0-9]{6,20}$/.test(saved.id) && typeof saved.name === 'string') return saved;
  } catch {
    // make a new one
  }
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const id = [...bytes].map((b) => (b % 36).toString(36)).join('');
  const ua = navigator.userAgent;
  const name = /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux computer' : /Mac/.test(ua) ? 'Mac' : 'This computer';
  const device = { id, name };
  try {
    localStorage.setItem(KEY, JSON.stringify(device));
  } catch {
    // fine
  }
  return device;
}
