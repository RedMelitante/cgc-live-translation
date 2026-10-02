// A repeating timer that keeps time in a hidden tab. Chrome throttles a
// hidden tab's own timers, after five minutes down to about once a minute,
// so a console minimised behind PowerPoint would hold every line that long
// (seen in testing: a background tab's countdowns stalled). A dedicated
// worker's timer isn't throttled that way, so it does the ticking and the
// page just answers each tick. Returns a function that stops it.
export function every(ms, fn) {
  try {
    const src = `setInterval(() => postMessage(0), ${Number(ms)});`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => fn();
    return () => worker.terminate();
  } catch {
    // No workers here: fall back to the page's own timer.
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }
}
