import { useCallback, useEffect, useState } from 'react';
import { effectiveWarmth, resolvePage, warmthOverlay } from './appearance/appearance';
import { useAppearance } from './appearance/useAppearance';
import { isDesktop } from './pwa';
import { newBrowserLocation, providerFor } from './project/locations';
import { forgetRecent, readRecent, rememberRecent } from './project/recent';
import { ProjectStore } from './project/store';
import { createFolder } from './storage/native';
import { projectFolderName } from './storage/paths';
import { About, usePlatformSetup } from './ui/About';
import { HelpMenu } from './ui/HelpMenu';
import { NewProject, type NewProjectRequest } from './ui/NewProject';
import { StartScreen } from './ui/StartScreen';
import { Workspace } from './ui/Workspace';

type Screen = { name: 'start' } | { name: 'new' } | { name: 'workspace'; store: ProjectStore };

export default function App() {
  const setup = usePlatformSetup();
  const [screen, setScreen] = useState<Screen>({ name: 'start' });
  const [recent, setRecent] = useState(readRecent);
  const [about, setAbout] = useState(false);
  const [error, setError] = useState('');

  const look = useAppearance();
  const [focus, setFocus] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const showError = useCallback((message: string) => setError(message), []);

  // The night-light schedule is checked once a minute.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const opened = (path: string, store: ProjectStore) => {
    setRecent(rememberRecent({ path, title: store.project.title, openedAt: Date.now() }));
    setScreen({ name: 'workspace', store });
    setError('');
  };

  const openProject = async (path: string) => {
    const result = await ProjectStore.open(await providerFor(path));
    if (!result.ok) {
      setError(`Couldn’t open that project. ${result.problems.slice(0, 3).join(' ')}`);
      return;
    }
    opened(path, result.store);
  };

  const createProject = async ({ title, author, settings, parent }: NewProjectRequest) => {
    const path = isDesktop && parent ? await createFolder(parent, projectFolderName(title)) : newBrowserLocation();
    const store = await ProjectStore.create(await providerFor(path), title, author, settings);
    opened(path, store);
  };

  const inWorkspace = screen.name === 'workspace';
  const dark = resolvePage(look.appearance, look.systemDark).dark;
  const warmth = effectiveWarmth(look.appearance, now);

  // Focus mode: Ctrl+Shift+F toggles, Esc leaves.
  useEffect(() => {
    if (!inWorkspace) return setFocus(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFocus((f) => !f);
      } else if (e.key === 'Escape') setFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inWorkspace]);

  return (
    <div className={`app ${inWorkspace ? 'app--workspace' : ''} ${focus ? 'app--focus' : ''}`} data-chrome={dark ? 'dark' : 'light'}>
      <div className="menubar">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="menubar__logo" />
        <span className="menubar__brand">Narrivell</span>
        {!isDesktop && inWorkspace && (
          <span className="menubar__note">Browser test project – not for real manuscripts</span>
        )}
        <span className="menubar__gap" />
        <HelpMenu onAbout={() => setAbout(true)} onError={showError} />
      </div>

      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" className="link-button" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      {screen.name === 'start' && (
        <StartScreen
          recent={recent}
          onNew={() => setScreen({ name: 'new' })}
          onOpen={openProject}
          onForget={(path) => setRecent(forgetRecent(path))}
          onError={showError}
        />
      )}
      {screen.name === 'new' && <NewProject onCancel={() => setScreen({ name: 'start' })} onCreate={createProject} />}
      {screen.name === 'workspace' && (
        <Workspace
          key={screen.store.storage.label}
          store={screen.store}
          look={look}
          focus={focus}
          onFocusChange={setFocus}
          onClose={() => setScreen({ name: 'start' })}
          onError={showError}
        />
      )}

      {about && <About setup={setup} onClose={() => setAbout(false)} />}
      {warmth > 0 && <div className="night-light" aria-hidden="true" style={{ backgroundColor: warmthOverlay(warmth) }} />}
    </div>
  );
}
