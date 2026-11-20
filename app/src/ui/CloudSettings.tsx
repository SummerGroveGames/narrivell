import { useEffect, useState } from 'react';
import { cloudStatus, connectDrive, disconnectDrive } from '../cloud/drive';
import { isDesktop } from '../pwa';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ACCOUNT_KEY = 'narrivell.cloud.account';

/** Settings › Cloud: connect Google Drive (Dropbox, OneDrive and WebDAV come next). */
export function CloudSettings({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<{ registered: boolean; connected: boolean } | null>(null);
  const [account, setAccount] = useState(() => localStorage.getItem(ACCOUNT_KEY) ?? '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = () => cloudStatus().then(setStatus).catch((e) => setError(message(e)));
  useEffect(() => {
    if (isDesktop) void refresh();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const connect = async () => {
    setBusy('Finish signing in in your browser…');
    setError('');
    try {
      const who = await connectDrive();
      setAccount(who);
      localStorage.setItem(ACCOUNT_KEY, who);
      await refresh();
      window.dispatchEvent(new Event('narrivell:cloud-changed'));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Drive on this computer? Your books stay where they are, on this computer and in Drive.')) return;
    try {
      await disconnectDrive();
      localStorage.removeItem(ACCOUNT_KEY);
      setAccount('');
      await refresh();
      window.dispatchEvent(new Event('narrivell:cloud-changed'));
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="cloud-title" onMouseDown={onClose}>
      <section className="card dialog dialog--wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="cloud-title">Cloud sync</h2>
        <p className="muted small">
          Your book always lives in its folder on this computer (or a USB drive). Cloud sync keeps a copy in your own cloud account and brings changes
          between your computers. Edits made on two computers are merged, never overwritten, and a snapshot is kept first.
        </p>
        {!isDesktop ? (
          <p className="notice">Cloud sync works in the Windows and Linux apps.</p>
        ) : (
          <div className="ai-providers">
            <div className="ai-provider ai-provider--on">
              <strong>Google Drive</strong>
              <span className="muted small">{status?.connected ? `Connected${account ? ` as ${account}` : ''}` : 'Not connected'}</span>
              {status && !status.registered ? (
                <span className="small error">This copy of Narrivell isn’t registered with Google yet.</span>
              ) : status?.connected ? (
                <button type="button" className="link-button" onClick={disconnect}>
                  Disconnect
                </button>
              ) : (
                <button type="button" className="button button--small" onClick={connect} disabled={!!busy || !status}>
                  Connect Google Drive
                </button>
              )}
            </div>
            {['Dropbox', 'OneDrive', 'Nextcloud / WebDAV'].map((n) => (
              <div key={n} className="ai-provider">
                <strong>{n}</strong>
                <span className="muted small">Coming soon</span>
              </div>
            ))}
          </div>
        )}
        {busy && <p className="notice small">{busy}</p>}
        {error && <p className="error small">{error}</p>}
        <p className="muted small">
          Narrivell can only see the files and folders it creates in your Drive (a folder called “Narrivell”), never the rest of your Drive. Your sign-in is
          kept in this computer’s keychain.
        </p>
        <div className="row">
          <button type="button" className="button button--quiet" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}
