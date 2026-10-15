import { fork } from 'node:child_process';
import createError from 'http-errors';

// Same as svgToPng() but renders in a persistent child process. Rendering
// blocks the event loop, which is bad for servers, and a native crash would
// abort the entire process (resvg panics used to, until resvg-js 2.7, see
// https://github.com/thx/resvg-js/issues/423). With this, only the child dies
// and gets restarted for the next job. Jobs are sent one at a
// time so a crash or timeout can be attributed to the right svg.
const workerPath = new URL('./worker.js', import.meta.url);
const renderTimeout = 20000;
const maxQueue = 50;

let worker = null;
let current = null;
let counter = 0;
const queue = [];

function startWorker() {
  // advanced serialization so the png buffer does not get converted to json.
  // Don't inherit the parent's node flags, e.g. --input-type breaks the child.
  const child = fork(workerPath, [], { serialization: 'advanced', execArgv: [] });
  child.on('message', ({ id, png, error }) => {
    if (!current || current.id !== id) return;
    const job = finishJob();
    if (error) {
      job.reject(createError(500, `Failed to render ${job.label}: ${error}`));
    } else {
      job.resolve(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
    }
  });
  child.on('exit', (code, signal) => {
    if (worker === child) worker = null;
    if (current) {
      const job = finishJob();
      console.log(`[CARD RENDERER] crashed (code ${code}, signal ${signal}) while rendering ${job.label}`);
      job.reject(createError(500, `Card renderer crashed while rendering ${job.label}`));
    }
  });
  child.on('error', (err) => {
    console.log(`[CARD RENDERER] error: ${err.message}`);
  });
  return child;
}

// The idle child should not keep the parent process alive
function setRef(child, ref) {
  if (ref) {
    child.ref();
    child.channel?.ref();
  } else {
    child.unref();
    child.channel?.unref();
  }
}

function finishJob() {
  const job = current;
  clearTimeout(job.timer);
  current = null;
  if (worker) setRef(worker, false);
  setImmediate(nextJob);
  return job;
}

function nextJob() {
  if (current || !queue.length) return;
  current = queue.shift();
  if (!worker) worker = startWorker();
  const child = worker;
  setRef(child, true);
  current.timer = setTimeout(() => {
    console.log(`[CARD RENDERER] timeout while rendering ${current.label}`);
    child.kill('SIGKILL'); // exit handler rejects the job, next job starts a new child
  }, renderTimeout);
  child.send({ id: current.id, svg: current.svg });
}

export function svgToPngSubprocess(svg, label = 'svg') {
  if (queue.length >= maxQueue) {
    return Promise.reject(createError(503, 'Card renderer is too busy, try again later'));
  }
  return new Promise((resolve, reject) => {
    queue.push({ id: ++counter, svg, label, resolve, reject });
    nextJob();
  });
}
