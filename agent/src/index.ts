import { config } from './config.js';
import { claimNextJob, setStatus, finishJob, logEvent, getClientCreds } from './supabase.js';
import { runJob } from './handlers.js';
import { closeBrowser } from './browser.js';

// Main loop: poll the queue, run one job at a time, write results back.
// One job at a time keeps portal load gentle and sessions clean (Phase 6 can add
// bounded concurrency with per-client isolation).

let running = true;

async function tick() {
  const job = await claimNextJob();
  if (!job) return;

  console.log(`\n▶ job ${job.id} · ${job.job_type} · ${job.mode}`);
  try {
    await setStatus(job.id, 'running', { attempts: (job.attempts || 0) + 1 });
    const creds = await getClientCreds(job.client_id);
    if (!creds) throw new Error('Client not found.');

    const result = await runJob(job, creds);

    // `verified` is set by the handler's self-check where applicable.
    const verified = result?.diffs ? result.diffs.length === 0 : (result?.verified ?? null);
    await finishJob(job.id, true, { result, verified });
    await logEvent(job.id, 'info', 'done', 'Job succeeded.');
    console.log(`✔ job ${job.id} succeeded`);
  } catch (err: any) {
    const message = err?.message || String(err);
    await finishJob(job.id, false, { error: message });
    await logEvent(job.id, 'error', 'failed', message);
    console.error(`x job ${job.id} failed: ${message}`);
  }
}

async function main() {
  console.log(`GST Keeper Portal Agent "${config.agentId}" started. Polling every ${config.pollIntervalMs}ms.`);
  console.log(`Headful: ${config.headful}. CAPTCHA: human-assisted (no auto-solver).`);
  while (running) {
    try {
      await tick();
    } catch (e) {
      console.error('Loop error:', e);
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

async function shutdown() {
  running = false;
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
