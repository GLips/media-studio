// ios-device-usb.ts: an iPad on the Mac's USB cable, through pymobiledevice3 (github.com/doronz88/pymobiledevice3,
// installed with `uv tool install pymobiledevice3`) and Xcode: which iPad is plugged in and what it runs, the files in
// an app's shared Documents folder (house_arrest: an app with file sharing on, as Procreate has), and a WebDriverAgent
// runner started on it and forwarded to the Mac. docs/procreate-probes.md has the one-time setup.
//
// pymobiledevice3 is a Python package with no stable command line for file transfer, so each call runs one short
// script with its own Python.

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { webDriverAgentReady } from './webdriveragent-client.ts';

export type IosDevice = { udid: string; name: string; productType: string; osVersion: string; osBuild: string };

/** Where the WebDriverAgent checkout, its build and the runner's log live: outside the repo, one per Mac. */
export const WEBDRIVERAGENT_HOME = join(homedir(), '.local/share/media-studio');
const WDA_SOURCE = join(WEBDRIVERAGENT_HOME, 'WebDriverAgent'), WDA_DERIVED = join(WEBDRIVERAGENT_HOME, 'wda-derived');
export const WEBDRIVERAGENT_URL = 'http://localhost:8100';

function pymobiledevicePython(): string {
  let tool: string;
  try {
    tool = execFileSync('which', ['pymobiledevice3'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('ios device: pymobiledevice3 is not installed; run `uv tool install pymobiledevice3` (docs/procreate-probes.md)');
  }
  const shebang = readFileSync(realpathSync(tool), 'utf8').split('\n')[0];
  return shebang.replace(/^#!/, '').trim();
}

/** The one script every call runs: an operation and its arguments in, JSON out. */
const DEVICE_SCRIPT = String.raw`
import asyncio, inspect, json, sys
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.usbmux import list_devices
async def aw(x): return (await x) if inspect.isawaitable(x) else x
async def main():
    op, args = sys.argv[1], json.loads(sys.argv[2])
    if op == 'devices':
        out = []
        for d in await aw(list_devices()):
            if d.connection_type != 'USB': continue
            ld = await aw(create_using_usbmux(serial=d.serial))
            v = ld.all_values
            out.append({'udid': d.serial, 'name': v.get('DeviceName'), 'productType': v.get('ProductType'), 'deviceClass': v.get('DeviceClass'), 'osVersion': v.get('ProductVersion'), 'osBuild': v.get('BuildVersion')})
        print(json.dumps(out)); return
    ld = await aw(create_using_usbmux(serial=args['udid']))
    if op == 'app':
        from pymobiledevice3.services.installation_proxy import InstallationProxyService
        apps = await aw(InstallationProxyService(lockdown=ld).get_apps(bundle_identifiers=[args['bundleId']]))
        a = apps.get(args['bundleId'], {})
        print(json.dumps({'version': a.get('CFBundleShortVersionString'), 'build': a.get('CFBundleVersion')})); return
    from pymobiledevice3.services.house_arrest import HouseArrestService
    ha = await aw(HouseArrestService.create(ld, args['bundleId'], documents_only=True))
    path = '/Documents/' + args.get('path', '')
    if op == 'ls': print(json.dumps(await aw(ha.listdir(path))))
    elif op == 'mkdir': await aw(ha.makedirs(path)); print('null')
    elif op == 'push': await aw(ha.set_file_contents(path, open(args['local'], 'rb').read())); print('null')
    elif op == 'pull': open(args['local'], 'wb').write(await aw(ha.get_file_contents(path))); print('null')
    elif op == 'rm': await aw(ha.rm(path)); print('null')
asyncio.run(main())
`;

function device<T>(op: string, args: Record<string, string> = {}): T {
  const out = execFileSync(pymobiledevicePython(), ['-c', DEVICE_SCRIPT, op, JSON.stringify(args)], { encoding: 'utf8', maxBuffer: 1 << 24 });
  return JSON.parse(out.trim().split('\n').at(-1)!) as T;
}

/** The iPad on the cable. Throws unless there's exactly one. */
export function connectedIpad(): IosDevice {
  const ipads = device<(IosDevice & { deviceClass: string })[]>('devices').filter((d) => d.deviceClass === 'iPad');
  if (ipads.length !== 1) throw new Error(`ios device: ${ipads.length} iPads on USB; plug in exactly one`);
  const { deviceClass: _, ...ipad } = ipads[0];
  return ipad;
}

export const iosAppVersion = (udid: string, bundleId: string) => device<{ version: string; build: string }>('app', { udid, bundleId });

/** An app's shared Documents folder (Files › On My iPad › the app), paths relative to it. */
export function iosAppDocuments(udid: string, bundleId: string) {
  return {
    list: (path = '') => device<string[]>('ls', { udid, bundleId, path }).filter((name) => !name.startsWith('.')),
    mkdir: (path: string) => void device('mkdir', { udid, bundleId, path }),
    push: (local: string, path: string) => void device('push', { udid, bundleId, path, local }),
    pull: (path: string, local: string) => void device('pull', { udid, bundleId, path, local }),
    remove: (path: string) => void device('rm', { udid, bundleId, path }),
  };
}

/**
 * Builds and signs the WebDriverAgent runner for `udid` with the Apple development team `team` (a free Personal Team
 * does; its profile lasts a week, so rebuild when the runner stops launching). Clones WebDriverAgent first if needed.
 */
export function buildWebDriverAgent({ udid, team, bundleId }: { udid: string; team: string; bundleId: string }) {
  mkdirSync(WEBDRIVERAGENT_HOME, { recursive: true });
  if (!existsSync(WDA_SOURCE)) execFileSync('git', ['clone', '--depth', '1', 'https://github.com/appium/WebDriverAgent.git', WDA_SOURCE], { stdio: 'inherit' });
  execFileSync('xcodebuild', [
    'build-for-testing', '-project', join(WDA_SOURCE, 'WebDriverAgent.xcodeproj'), '-scheme', 'WebDriverAgentRunner', '-destination', `id=${udid}`,
    '-derivedDataPath', WDA_DERIVED, '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration',
    `DEVELOPMENT_TEAM=${team}`, 'CODE_SIGN_STYLE=Automatic', `PRODUCT_BUNDLE_IDENTIFIER=${bundleId}`,
  ], { stdio: 'inherit' });
}

/**
 * Makes sure a WebDriverAgent answers at WEBDRIVERAGENT_URL: starts the port forward and the runner if they aren't
 * up, each detached so they outlive this process, and waits for it. The runner must have been built.
 */
export async function ensureWebDriverAgent(udid: string, log: (line: string) => void = () => {}): Promise<void> {
  if (await webDriverAgentReady(WEBDRIVERAGENT_URL)) return;
  if (!existsSync(WDA_DERIVED)) throw new Error('ios device: the WebDriverAgent runner isn\'t built; run `studio brushes capture --setup --team <id>` first');
  const detached = (command: string, args: string[], logName: string) => {
    const out = openSync(join(WEBDRIVERAGENT_HOME, logName), 'a');
    spawn(command, args, { detached: true, stdio: ['ignore', out, out] }).unref();
    closeSync(out);
  };
  log('starting the USB forward and the WebDriverAgent runner');
  detached('pymobiledevice3', ['usbmux', 'forward', '--serial', udid, '8100', '8100'], 'wda-forward.log');
  detached('xcodebuild', ['test-without-building', '-project', join(WDA_SOURCE, 'WebDriverAgent.xcodeproj'), '-scheme', 'WebDriverAgentRunner', '-destination', `id=${udid}`, '-derivedDataPath', WDA_DERIVED], 'wda-run.log');
  const deadline = Date.now() + 120_000;
  while (!(await webDriverAgentReady(WEBDRIVERAGENT_URL))) {
    if (Date.now() > deadline) throw new Error(`ios device: WebDriverAgent didn't come up in 2 minutes; see ${join(WEBDRIVERAGENT_HOME, 'wda-run.log')}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
