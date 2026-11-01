// Limits the frame rate on displays refreshing faster than `maxFps`
// (e.g. 120 / 144 Hz). Call with each requestAnimationFrame timestamp [ms];
// returns whether to render that frame.
export function frameLimiter(maxFps) {
  const interval = 1000 / maxFps;
  // rAF timestamps jitter around the refresh period, so frames arriving
  // slightly early are accepted. This allows at most 1000 / (interval -
  // tolerance) fps, about 61.8 for 60.
  const tolerance = 0.5; // [ms]
  var next;
  return t => {
    if (next !== undefined && t < next - tolerance) return false;
    // Keep a steady cadence (e.g. 2-3-2-3 refreshes at 144 Hz). If this frame
    // came early, re-anchor to it, so that a display slightly faster than
    // maxFps doesn't drift ahead and drop frames. If behind (dropped frames,
    // hidden tab), restart from now instead of rendering a burst.
    next = next === undefined ? t + interval : Math.min(next, t) + interval;
    if (next <= t) next = t + interval;
    return true;
  };
}
