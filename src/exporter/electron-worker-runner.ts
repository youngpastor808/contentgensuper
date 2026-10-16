/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dedicated Electron Export Worker Runner.
 * 
 * Loaded exclusively in the hidden Electron background BrowserWindow (?exportWorker=1).
 * Runs completely unthrottled (backgroundThrottling: false) with dedicated JS heap memory.
 * Executes segmented exports using the proven drawVideoFrame() renderer,
 * and streams real-time progress events back to the main window.
 */
import '../exportBridge';
import { state } from '../state';
import { timelineState } from '../state-timeline';
import { exportWithSegmentedPipeline } from './segmented-exporter';
import { electronService } from './electron-bridge';
import { validateBeforeExport } from '../timing/timeline-timing';

export interface ElectronExportWorkerJob {
  payload: any;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  preferHardware?: boolean;
}

export function initElectronWorkerListener() {
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI || !electronAPI.on) {
    console.warn('[EXPORT WORKER] electronAPI is not available in worker window.');
    return;
  }

  console.log('[EXPORT WORKER] Dedicated background export worker initialized & ready.');
  
  // Signal to the main window that this background worker is alive and ready
  electronService('export-worker-relay-event', { type: 'worker-ready' });

  electronAPI.on('export-worker-job', async (job: ElectronExportWorkerJob) => {
    console.log('[EXPORT WORKER] Received export job:', job);
    try {
      state.isVideoProductionRunning = true;
      state.isExporting = true;

      const bridge = (window as any).__exportBridge;
      if (!bridge) {
        throw new Error('Export bridge is not loaded in worker.');
      }

      electronService('export-worker-relay-event', {
        type: 'progress',
        progress: 1,
        message: 'Pre-loading media assets in dedicated background worker...'
      });

      // 1. Preload and rehydrate all clip media & state via proven export bridge
      await bridge.init(job.payload);

      // Validate timeline sync before unthrottled segmented export pipeline
      const syncMode = (timelineState.mode === 'audio_locked' || (timelineState.masterAudioBuffer && timelineState.isAudioLocked?.())) ? 'audio_locked' : 'free';
      validateBeforeExport(
        timelineState.clips,
        timelineState.masterAudioBuffer?.duration ?? null,
        { mode: syncMode }
      );

      electronService('export-worker-relay-event', {
        type: 'progress',
        progress: 5,
        message: 'Assets ready. Starting unthrottled segmented export pipeline...'
      });

      // 2. Execute segmented 3-5 minute pipeline with proven drawVideoFrame renderer
      await exportWithSegmentedPipeline(
        job.outputPath,
        job.width,
        job.height,
        job.fps,
        job.preferHardware ?? true,
        (progress: number, message: string) => {
          electronService('export-worker-relay-event', {
            type: 'progress',
            progress,
            message
          });
        }
      );

      // 3. Clean up memory
      try {
        bridge.cleanup();
      } catch {}

      // 4. Report completion
      electronService('export-worker-relay-event', {
        type: 'complete',
        outputPath: job.outputPath
      });
      console.log('[EXPORT WORKER] Export job completed successfully:', job.outputPath);
    } catch (err: any) {
      console.error('[EXPORT WORKER] Export job failed:', err);
      electronService('export-worker-relay-event', {
        type: 'error',
        error: err?.message || String(err)
      });
    } finally {
      state.isVideoProductionRunning = false;
      state.isExporting = false;
    }
  });
}

// Auto-run if booted in worker mode
if (typeof window !== 'undefined') {
  initElectronWorkerListener();
}
