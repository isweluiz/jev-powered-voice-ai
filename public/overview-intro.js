// One clock for every Overview number and chart; callers own its mount lifecycle.
export function startOverviewIntro(render, {
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  now = () => performance.now(),
  motion = matchMedia('(prefers-reduced-motion: reduce)'),
} = {}) {
  let frameId = null, stopped = false, p = motion.matches ? 1 : 0;
  const start = now();
  const cancel = () => {
    stopped = true;
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    motion.removeEventListener('change', onMotionChange);
  };
  const onMotionChange = event => {
    if (!event.matches || stopped) return;
    cancel();
    p = 1;
    render(p);
  };
  const frame = time => {
    if (stopped) return;
    frameId = null;
    const x = Math.min(1, Math.max(0, (time - start) / 1400));
    p = 1 - (1 - x) ** 3;
    render(p);
    if (x < 1) frameId = requestFrame(frame);
    else cancel();
  };
  render(p);
  if (p < 1) {
    motion.addEventListener('change', onMotionChange);
    frameId = requestFrame(frame);
  }
  return cancel;
}
