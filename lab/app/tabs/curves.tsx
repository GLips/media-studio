// Placeholder until this tab is built.
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { LabStage, LabTabIntro } from '../ui.tsx';

const Probe = ({ color }: { color: string }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: '#0c0c0e' }}><div style={{ position: 'absolute', left: 100 + f * 20, top: 500, width: 80, height: 80, background: color }} /></AbsoluteFill>;
};

export function CurvesTab() {
  return (
    <>
      <LabTabIntro number={1} title="Curves" what="w" when="w" bad="b" good="g" />
      <LabStage component={Probe} inputProps={{ color: '#ee4c23' }} seconds={2} label="PROBE" />
    </>
  );
}
