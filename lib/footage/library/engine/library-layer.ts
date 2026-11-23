// library-layer.ts: every service a library program uses, over Node's own (runStudioEffect provides those). Each
// CLI verb runs with this one layer; a test builds its own beside it with fakes for ffmpeg and whisper.
import { Layer } from 'effect';
import { footageTranscriberLayer } from '#lib/footage/transcript/engine/footage-transcriber.ts';
import { libraryMediaFolderLayer } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { studioFfmpegLayer } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { recorderDeviceLatenciesLayer } from './library-recorder-latencies.ts';
import { libraryStoreLayer } from './library-store.ts';

export const libraryLayer = Layer.mergeAll(libraryStoreLayer, libraryMediaFolderLayer, recorderDeviceLatenciesLayer, studioFfmpegLayer, footageTranscriberLayer);
