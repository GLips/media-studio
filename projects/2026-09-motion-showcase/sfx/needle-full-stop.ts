// Written by `studio sfx render buzz.strike --out projects/2026-09-motion-showcase/sfx/needle-full-stop.wav --seed "needle-566" --set lead=0.1,hold=0.12,spinDown=0.08,snap=1,boom=1.5,weight=0.4`. Rerun that to change it.
import type { SfxSound } from '#studio/sfx/sfx.tsx';
import src from './needle-full-stop.wav';

export default { src, seconds: 1.6635, landsAt: 0.15, request: {"sound":"buzz.strike","seed":"needle-566","set":{"lead":0.1,"hold":0.12,"spinDown":0.08,"snap":1,"boom":1.5,"weight":0.4}} } satisfies SfxSound;
