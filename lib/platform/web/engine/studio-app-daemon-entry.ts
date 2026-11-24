// studio-app-daemon-entry.ts: the managed studio app's process (studio-app-daemon.ts spawns it detached). Its
// `--instance` argument is how the manager recognises it in `ps` before signalling it, so it stays on the command line.
import { parseArgs } from 'node:util';
import { exitStudioProcessOnSignals } from '#lib/platform/process/engine/studio-signal-exit.ts';
import { forgetStudioAppInstance } from './studio-app-daemon.ts';
import { startStudioAppViteServer } from './studio-app-server.ts';

exitStudioProcessOnSignals();
const { values } = parseArgs({ options: { port: { type: 'string' }, instance: { type: 'string' } } });
const port = Number(values.port);
const instanceId = values.instance!;
// Whatever ends it, its state file goes with it, unless a newer instance has already replaced the file.
process.on('exit', () => forgetStudioAppInstance(port, instanceId));
await startStudioAppViteServer({ port, instanceId });
process.stderr.write(`${new Date().toISOString()} serving the studio app on http://localhost:${port}\n`);
