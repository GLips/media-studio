// StudioLab.tsx: the tab bar and the tab it shows. The open tab lives in the URL's hash, so a link or a reload lands
// on the same one.
import { useEffect, useState, type ComponentType } from 'react';
import { CurvesTab } from './tabs/curves.tsx';
import { HoldTab } from './tabs/hold.tsx';
import { KitTab } from './tabs/kit.tsx';
import { MediaTab } from './tabs/media.tsx';
import { SoundTab } from './tabs/sound.tsx';
import { StaggerTab } from './tabs/stagger.tsx';

const LAB_TABS: readonly { id: string; label: string; Tab: ComponentType }[] = [
  { id: 'curves', label: 'Curves & springs', Tab: CurvesTab },
  { id: 'stagger', label: 'Stagger', Tab: StaggerTab },
  { id: 'kit', label: 'Kit pieces', Tab: KitTab },
  { id: 'hold', label: 'Hold check', Tab: HoldTab },
  { id: 'sound', label: 'Sound', Tab: SoundTab },
  { id: 'media', label: 'Generated media', Tab: MediaTab },
];

const tabFromHash = () => LAB_TABS.find((t) => `#${t.id}` === location.hash) ?? LAB_TABS[0];

export function StudioLab() {
  const [tab, setTab] = useState(tabFromHash);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  return (
    <div className="lab">
      <header className="lab-header">
        <div className="lab-brand">
          <span className="hud">VIDEO STUDIO</span>
          <h1>Studio Lab</h1>
          <p>Every lever the studio pulls when it makes a video, one tab each. Drag things. Nothing here costs money.</p>
        </div>
        <nav className="lab-tabs">
          {LAB_TABS.map((t, i) => (
            <a key={t.id} href={`#${t.id}`} className={t === tab ? 'on' : undefined}>
              <span className="hud">{String(i + 1).padStart(2, '0')}</span> {t.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="lab-main">
        <tab.Tab key={tab.id} />
      </main>
    </div>
  );
}
