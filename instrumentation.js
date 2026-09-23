/**
 * Next.js server instrumentation — starts the background job worker once when
 * the Node server bootstraps (development and production). The worker only ever
 * runs on a long-lived server; it is skipped during `next build`.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  try {
    const { startWorker } = await import('./lib/jobs/worker.js');
    startWorker();
    console.log('[background-jobs] worker started');
    const { startScheduler } = await import('./lib/jobs/scheduler.js');
    startScheduler();
    console.log('[background-jobs] discovery scheduler started');
  } catch (err) {
    console.error('[background-jobs] worker failed to start:', err?.message || err);
  }
}