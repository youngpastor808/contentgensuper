let until = 0;
export const markInteraction = (ms = 250) => { until = performance.now() + ms; };
export const isInteracting = () => performance.now() < until;

let restoreTimer = 0;
export function scheduleFullQualityRedraw() {
  clearTimeout(restoreTimer);
  restoreTimer = window.setTimeout(async () => {
    try {
      const { state } = await import('./state');
      const { drawVideoFrame, videoRenderContext } = await import('./videoRenderer');
      if (!state.isVideoPlaying && !state.isExporting && videoRenderContext) {
        drawVideoFrame(state.lastRenderedTime);
      }
    } catch {}
  }, 260);
}
