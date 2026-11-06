/**
 * The longest time the event loop was held while `work` ran, in milliseconds (DB review 1): a turn that takes longer
 * than 200 ms makes Discord's audio queue run dry. A synchronous call holds it for its whole length; bulk work that
 * yields between batches holds it for its longest batch. `cpu` counts the processor time this thread used in that
 * turn, which other programs on a busy machine cannot inflate (the test may run alongside others, as in the full
 * `yarn test`), and which leaves out worker threads (a backup's copy); `wall` is the clock time, for reports only.
 */
export async function longestHold(work: () => unknown): Promise<{ wall: number; cpu: number }> {
  const cpuNow = () => {
    const used = process.threadCpuUsage();
    return (used.user + used.system) / 1000;
  };
  let wall = 0;
  let cpu = 0;
  let lastWall = performance.now();
  let lastCpu = cpuNow();
  let running = true;
  const turn = () => {
    const nowWall = performance.now();
    const nowCpu = cpuNow();
    wall = Math.max(wall, nowWall - lastWall);
    cpu = Math.max(cpu, nowCpu - lastCpu);
    lastWall = nowWall;
    lastCpu = nowCpu;
  };
  const tick = () => {
    turn();
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  lastWall = performance.now();
  lastCpu = cpuNow();
  try {
    await work();
  } finally {
    running = false;
  }
  turn();
  return { wall, cpu };
}
