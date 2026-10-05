// studio gpu: who has the machine's one GPU and who waits for it, read from the lease's tickets (lib/platform/gpu).
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'gpu',
    description: "Who has the GPU and who waits for it: each slot (interactive: look, still and paint; batch: render, profile and every other verb that draws) with the command holding it, its pid and how long it has held it, then the slot's queue in order, each with how long it has waited. The GPU gate holds both slots. Every checkout of the studio queues in the one line, so theirs show too.",
  },
  async run() {
    const { readStudioGpuTickets } = await import('#lib/platform/gpu/engine/gpu-lease.ts');
    const { studioGpuQueueLines } = await import('#lib/platform/gpu/models/gpu-lease-queue.ts');
    for (const line of studioGpuQueueLines(readStudioGpuTickets(), Date.now())) console.log(line);
  },
});
