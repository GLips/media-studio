// studio transcribe: what's said in any audio or video file, word-timed (lib/footage/transcript/engine/transcribe-footage.ts).
import { defineCommand } from 'citty';

const minutesAndSeconds = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

export default defineCommand({
  meta: {
    name: 'transcribe',
    description: 'Print what is said in an audio or video file, word-timed, by local whisper.',
    about: "Hears the file in pieces split at its pauses, so word times hold across a long recording and a phrase said twice (a retake) is printed twice; each word's edges are placed at the audio's pauses. Prints a line per stretch of speech, at its start (m:ss.s). With --json, the transcript as JSON: duration, words (text, start, end in seconds) and pauses (every quiet stretch of at least 40 ms). Asking again for the same file answers from the user cache at once. The first run installs whisper.cpp and its model (~1.5 GB).",
  },
  args: {
    file: { type: 'positional', required: true, description: 'An audio or video file with an audio track' },
    json: { type: 'boolean', description: 'Print the transcript as JSON' },
  },
  async run({ args }) {
    const { transcribeFootage } = await import('#lib/footage/transcript/engine/transcribe-footage.ts');
    const { transcriptLines } = await import('#lib/footage/transcript/models/footage-transcript.ts');
    const transcript = await transcribeFootage(args.file);
    if (args.json) {
      console.log(JSON.stringify(transcript));
      return;
    }
    for (const line of transcriptLines(transcript)) console.log(`${minutesAndSeconds(line.start)}  ${line.text}`);
  },
});
