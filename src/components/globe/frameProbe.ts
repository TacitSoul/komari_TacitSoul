import { SLOW_DEVICE_FPS } from '@/components/earth/earthPerformance';

const WARMUP_MS = 2500;
const PROBE_MS = 3000;

/** Only an uninterrupted, visible full-rate run may classify the device. */
export function createFrameProbe(wake: (fullRateMs: number) => void, onSlow: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let done = false;
  let startedAt: number | null = null;
  let frames = 0;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    startedAt = null;
    frames = 0;
  };

  return {
    setRunning(next: boolean) {
      if (next === running) return;
      running = next;
      cancel();
      if (!running || done) return;
      timer = setTimeout(() => {
        startedAt = performance.now();
        frames = 0;
        wake(PROBE_MS);
        timer = setTimeout(() => {
          if (!running || startedAt === null) return;
          const fps = frames / ((performance.now() - startedAt) / 1000);
          done = true;
          cancel();
          if (fps < SLOW_DEVICE_FPS) onSlow();
        }, PROBE_MS);
      }, WARMUP_MS);
    },
    frame() {
      if (running && startedAt !== null) frames += 1;
    },
    dispose() {
      running = false;
      done = true;
      cancel();
    },
  };
}
