"use strict";
// Offline-safe write queue: ops persist in storage, flush one at a time, retry on
// transient errors, drop on permanent ones, pause when the session has expired.

const AUTH_CODES = ["PGRST301", "PGRST302"];
const AUTH_MSG = /JWT|JWS|not authenticated|refresh token|session (missing|expired)|invalid claims|sign in first/i;
// permission denied, function not found, bad uuid, value too long, not-null, FK, check violations
const PERMANENT_CODES = ["42501", "PGRST202", "22P02", "22001", "23502", "23503", "23514"];

export function errorKind(err) {
  const msg = String((err && (err.message || err.error_description)) || err || "");
  const code = err && err.code;
  if ((err && err.status === 401) || AUTH_CODES.includes(code) || AUTH_MSG.test(msg)) return "auth";
  if (/^(forbidden|not_found|invalid)\b/.test(msg) || PERMANENT_CODES.includes(code)) return "permanent";
  return "transient";
}

function safe(fn, ...args) {
  try { if (typeof fn === "function") fn(...args); } catch (e) { console.error("queue callback failed:", e); }
}

export function createQueue({ storage, write, onApplied, onPermanent, onAuthNeeded, onChange,
  schedule = (fn, ms) => setTimeout(fn, ms), retryMs = 5000 }) {
  let ops = [];
  try {
    const loaded = storage.load();
    if (Array.isArray(loaded)) ops = loaded;
  } catch (e) { console.error("queue load failed:", e); }
  let flushing = false;
  let paused = false;
  let retryPending = false;
  const save = () => {
    try { storage.save(ops); } catch (e) { console.error("queue save failed:", e); }
  };

  function scheduleRetry() {
    if (retryPending) return;
    retryPending = true;
    schedule(() => { retryPending = false; return flush(); }, retryMs);
  }

  function flush() {
    if (flushing || paused || !ops.length) return Promise.resolve();
    flushing = true;
    const op = ops[0];
    return Promise.resolve().then(() => write(op)).then(result => {
      if (op.method === "add_evidence" && result && result.id && result.id !== op.payload.id) {
        ops.forEach(q => { if (q.payload && q.payload.evidenceId === op.payload.id) q.payload.evidenceId = result.id; });
      }
      ops.shift(); save(); flushing = false;
      safe(onApplied, op, result); safe(onChange);
      return flush();
    }, err => {
      flushing = false;
      const kind = errorKind(err);
      if (kind === "permanent") {
        ops.shift(); save();
        safe(onPermanent, op, err); safe(onChange);
        return flush();
      }
      if (kind === "auth") {
        paused = true;
        safe(onAuthNeeded, ops.length); safe(onChange);
        return undefined;
      }
      scheduleRetry();
      return undefined;
    }).catch(e => { flushing = false; console.error("queue flush failed:", e); });
  }

  return {
    all: () => ops.slice(),
    forProgramme: pid => ops.filter(o => o.programmeId === pid),
    enqueue(op) { ops.push(op); save(); safe(onChange); return flush(); },
    flush,
    resume() { paused = false; return flush(); },
    isPaused: () => paused,
  };
}
