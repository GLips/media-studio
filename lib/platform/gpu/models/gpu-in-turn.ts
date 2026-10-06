// gpu-in-turn.ts: asynchronous GPU steps run one after another. Steps that share targets, a uniform arena or a
// device's solve lease, or whose error checks must not interleave, can't overlap, so each is awaited before the next
// starts, in order.

/** `step` over `items` in order, each awaited before the next starts, and their answers in that order. */
export function gpuEachInTurn<T, R>(items: Iterable<T>, step: (item: T, index: number) => Promise<R>): Promise<R[]> {
  return [...items].reduce<Promise<R[]>>(async (before, item, index) => {
    const answers = await before;
    answers.push(await step(item, index));
    return answers;
  }, Promise.resolve([]));
}
