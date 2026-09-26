// kit-stand-in-page.tsx: the product page the Kit pieces tab's cards sit over, since in a video a card always sits on
// top of a scene.
import { AbsoluteFill } from 'remotion';
import { FONT } from '#models/frame/frame.ts';
import { LAB_COLORS } from '../lab-format.ts';

/** A heading and a few order rows, in the system font, as a walkthrough's captured page looks. */
export function KitStandInPage() {
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.cream, fontFamily: FONT, color: LAB_COLORS.ink }}>
      <div style={{ position: 'absolute', left: 160, top: 150, fontSize: 64, fontWeight: 800 }}>Your orders</div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ position: 'absolute', left: 160, top: 290 + i * 130, width: 1600, height: 100, borderRadius: 18, background: '#fff', display: 'flex', alignItems: 'center', gap: 28, padding: '0 32px', boxShadow: '0 4px 16px rgba(20,11,14,0.08)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: i % 2 ? LAB_COLORS.cobalt : LAB_COLORS.red }} />
          <div style={{ width: 420 - i * 40, height: 22, borderRadius: 11, background: '#d9d4c7' }} />
          <div style={{ marginLeft: 'auto', fontSize: 34, fontWeight: 700 }}>${(49 + i * 23).toFixed(2)}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
}
