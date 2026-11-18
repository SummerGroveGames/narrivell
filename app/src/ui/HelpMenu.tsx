import { useEffect, useRef, useState } from 'react';
import { CONTACT, type ContactKind, contactLink } from '../config/contact';
import { openMail } from '../storage/native';
import { platform } from './About';

const ITEMS: { kind: ContactKind; label: string }[] = [
  { kind: 'featureRequest', label: 'Request a feature…' },
  { kind: 'feedback', label: 'Report a problem…' },
  { kind: 'support', label: 'Contact support…' },
];

export function HelpMenu({ onAbout, onError }: { onAbout: () => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const mail = (kind: ContactKind) => {
    setOpen(false);
    openMail(contactLink(kind, __APP_VERSION__, platform)).catch(() =>
      onError(`Couldn’t open your email app. You can write to ${CONTACT[kind]}.`),
    );
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="menu__button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Help
      </button>
      {open && (
        <ul className="menu__list" role="menu">
          {ITEMS.map((item) => (
            <li key={item.kind} role="none">
              <button type="button" role="menuitem" onClick={() => mail(item.kind)}>
                {item.label}
              </button>
            </li>
          ))}
          <li role="none" className="menu__divider" />
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAbout();
              }}
            >
              About Narrivell
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
