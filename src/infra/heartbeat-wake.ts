import { normalizeOptionalString } from "../shared/string-coerce.js";
import { normalizeHeartbeatWakeReason } from "./heartbeat-reason.js";

export type HeartbeatRunResult =
  | { status: "ran"; durationMs: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export const HEARTBEAT_SKIP_REQUESTS_IN_FLIGHT = "requests-in-flight";
export const HEARTBEAT_SKIP_CRON_IN_PROGRESS = "cron-in-progress";
export const HEARTBEAT_SKIP_LANES_BUSY = "lanes-busy";
export type RetryableHeartbeatBusySkipReason =
  | typeof HEARTBEAT_SKIP_REQUESTS_IN_FLIGHT
  | typeof HEARTBEAT_SKIP_CRON_IN_PROGRESS
  | typeof HEARTBEAT_SKIP_LANES_BUSY;

const RETRYABLE_BUSY_SKIP_REASONS = new Set([
  HEARTBEAT_SKIP_REQUESTS_IN_FLIGHT,
  HEARTBEAT_SKIP_CRON_IN_PROGRESS,
  HEARTBEAT_SKIP_LANES_BUSY,
]);

export function isRetryableHeartbeatBusySkipReason(reason: string): boolean {
  return RETRYABLE_BUSY_SKIP_REASONS.has(reason);
}

export type HeartbeatWakeIntent = "scheduled" | "event" | "immediate" | "manual";

export type HeartbeatWakeSource =
  | "interval"
  | "manual"
  | "exec-event"
  | "notifications-event"
  | "cron"
  | "hook"
  | "background-task"
  | "background-task-blocked"
  | "acp-spawn"
  | "cli-watchdog"
  | "restart-sentinel"
  | "retry"
  | "other";

export type HeartbeatWakeRequest = {
  source: HeartbeatWakeSource;
  intent: HeartbeatWakeIntent;
  reason?: string;
  agentId?: string;
  sessionKey?: string;
  heartbeat?: { target?: string };
};

export type HeartbeatWakeHandler = (opts: HeartbeatWakeRequest) => Promise<HeartbeatRunResult>;

let heartbeatsEnabled = true;

export function setHeartbeatsEnabled(enabled: boolean) {
  heartbeatsEnabled = enabled;
}

export function areHeartbeatsEnabled(): boolean {
  return heartbeatsEnabled;
}

type WakeTimerKind = "normal" | "retry";
type PendingWakeReason = {
  source: HeartbeatWakeSource;
  intent: HeartbeatWakeIntent;
  reason: string;
  priority: number;
  requestedAt: number;
  agentId?: string;
  sessionKey?: string;
  heartbeat?: { target?: string };
};

let handler: HeartbeatWakeHandler | null = null;
let handlerGeneration = 0;
const pendingWakes = new Map<string, PendingWakeReason>();
let scheduled = false;
let running = false;
let timer: NodeJS.Timeout | null = null;
let timerDueAt: number | null = null;
let timerKind: WakeTimerKind | null = null;

// Liveness/watchdog state (fork): track when a wake last completed so the
// healthcheck and hot-reload paths can detect a stuck `running` lock and the
// timer callback can enforce a hard cap on `await active(...)`.
let lastWakeCompletedAt: number | null = null;
let lastWakeStartedAt: number | null = null;
let expectedIntervalMs: number | null = null;
const WAKE_HANDLER_TIMEOUT_MS = 5 * 60 * 1000;
const WAKE_HANDLER_MIN_GRACE_MS = 60 * 1000;

const DEFAULT_COALESCE_MS = 250;
const DEFAULT_RETRY_MS = 1_000;
const REASON_PRIORITY = {
  RETRY: 0,
  INTERVAL: 1,
  DEFAULT: 2,
  ACTION: 3,
} as const;

function resolveWakePriority(params: {
  source: HeartbeatWakeSource;
  intent: HeartbeatWakeIntent;
  reason: string;
}): number {
  if (params.intent === "manual" || params.intent === "immediate") {
    return REASON_PRIORITY.ACTION;
  }
  if (params.source === "retry" || params.reason === "retry") {
    return REASON_PRIORITY.RETRY;
  }
  if (
    params.intent === "scheduled" ||
    params.source === "interval" ||
    params.reason === "interval"
  ) {
    return REASON_PRIORITY.INTERVAL;
  }
  return REASON_PRIORITY.DEFAULT;
}

function normalizeWakeReason(reason?: string): string {
  return normalizeHeartbeatWakeReason(reason);
}

function normalizeWakeTarget(value?: string): string | undefined {
  const trimmed = normalizeOptionalString(value) ?? "";
  return trimmed || undefined;
}

function getWakeTargetKey(params: { agentId?: string; sessionKey?: string }) {
  const agentId = normalizeWakeTarget(params.agentId);
  const sessionKey = normalizeWakeTarget(params.sessionKey);
  return `${agentId ?? ""}::${sessionKey ?? ""}`;
}

function queuePendingWakeReason(params: {
  source: HeartbeatWakeSource;
  intent: HeartbeatWakeIntent;
  reason?: string;
  requestedAt?: number;
  agentId?: string;
  sessionKey?: string;
  heartbeat?: { target?: string };
}) {
  const requestedAt = params.requestedAt ?? Date.now();
  const normalizedReason = normalizeWakeReason(params.reason);
  const normalizedAgentId = normalizeWakeTarget(params.agentId);
  const normalizedSessionKey = normalizeWakeTarget(params.sessionKey);
  const wakeTargetKey = getWakeTargetKey({
    agentId: normalizedAgentId,
    sessionKey: normalizedSessionKey,
  });
  const next: PendingWakeReason = {
    source: params.source,
    intent: params.intent,
    reason: normalizedReason,
    priority: resolveWakePriority({
      source: params.source,
      intent: params.intent,
      reason: normalizedReason,
    }),
    requestedAt,
    agentId: normalizedAgentId,
    sessionKey: normalizedSessionKey,
    heartbeat: params.heartbeat,
  };
  const previous = pendingWakes.get(wakeTargetKey);
  if (!previous) {
    pendingWakes.set(wakeTargetKey, next);
    return;
  }
  const merged =
    (next.heartbeat ?? previous.heartbeat)
      ? { ...next, heartbeat: next.heartbeat ?? previous.heartbeat }
      : next;
  if (next.priority > previous.priority) {
    pendingWakes.set(wakeTargetKey, merged);
    return;
  }
  if (next.priority === previous.priority && next.requestedAt >= previous.requestedAt) {
    pendingWakes.set(wakeTargetKey, merged);
  }
}

function schedule(coalesceMs: number, kind: WakeTimerKind = "normal") {
  const delay = Number.isFinite(coalesceMs) ? Math.max(0, coalesceMs) : DEFAULT_COALESCE_MS;
  const dueAt = Date.now() + delay;
  if (timer) {
    // Keep retry cooldown as a hard minimum delay. This prevents the
    // finally-path reschedule (often delay=0) from collapsing backoff.
    if (timerKind === "retry") {
      return;
    }
    // If existing timer fires sooner or at the same time, keep it.
    if (typeof timerDueAt === "number" && timerDueAt <= dueAt) {
      return;
    }
    // New request needs to fire sooner — preempt the existing timer.
    clearTimeout(timer);
    timer = null;
    timerDueAt = null;
    timerKind = null;
  }
  timerDueAt = dueAt;
  timerKind = kind;
  timer = setTimeout(async () => {
    timer = null;
    timerDueAt = null;
    timerKind = null;
    scheduled = false;
    const active = handler;
    if (!active) {
      return;
    }
    if (running) {
      scheduled = true;
      schedule(delay, kind);
      return;
    }

    const pendingBatch = Array.from(pendingWakes.values());
    pendingWakes.clear();
    running = true;
    lastWakeStartedAt = Date.now();
    try {
      for (const pendingWake of pendingBatch) {
        const wakeOpts = {
          source: pendingWake.source,
          intent: pendingWake.intent,
          reason: pendingWake.reason ?? undefined,
          ...(pendingWake.agentId ? { agentId: pendingWake.agentId } : {}),
          ...(pendingWake.sessionKey ? { sessionKey: pendingWake.sessionKey } : {}),
          ...(pendingWake.heartbeat ? { heartbeat: pendingWake.heartbeat } : {}),
        };
        // Watchdog (fork): cap a single wake handler invocation so a stuck
        // delivery / model call can't latch `running=true` forever and block
        // every subsequent heartbeat. The underlying promise keeps running in
        // the background but the lock is released so future wakes can fire.
        const res = await raceWakeHandler(active(wakeOpts), pendingWake);
        if (res.status === "skipped" && isRetryableHeartbeatBusySkipReason(res.reason)) {
          // The target runtime is busy; retry this wake target soon.
          queuePendingWakeReason({
            source: pendingWake.source,
            intent: pendingWake.intent,
            reason: pendingWake.reason ?? "retry",
            agentId: pendingWake.agentId,
            sessionKey: pendingWake.sessionKey,
            heartbeat: pendingWake.heartbeat,
          });
          schedule(DEFAULT_RETRY_MS, "retry");
        }
      }
    } catch {
      // Error is already logged by the heartbeat runner; schedule a retry.
      for (const pendingWake of pendingBatch) {
        queuePendingWakeReason({
          source: pendingWake.source,
          intent: pendingWake.intent,
          reason: pendingWake.reason ?? "retry",
          agentId: pendingWake.agentId,
          sessionKey: pendingWake.sessionKey,
          heartbeat: pendingWake.heartbeat,
        });
      }
      schedule(DEFAULT_RETRY_MS, "retry");
    } finally {
      running = false;
      lastWakeCompletedAt = Date.now();
      lastWakeStartedAt = null;
      if (pendingWakes.size > 0 || scheduled) {
        schedule(delay, "normal");
      }
    }
  }, delay);
  timer.unref?.();
}

/**
 * Register (or clear) the heartbeat wake handler.
 * Returns a disposer function that clears this specific registration.
 * Stale disposers (from previous registrations) are no-ops, preventing
 * a race where an old runner's cleanup clears a newer runner's handler.
 */
export function setHeartbeatWakeHandler(next: HeartbeatWakeHandler | null): () => void {
  handlerGeneration += 1;
  const generation = handlerGeneration;
  handler = next;
  if (next) {
    // New lifecycle starting (e.g. after SIGUSR1 in-process restart).
    // Clear any timer metadata from the previous lifecycle so stale retry
    // cooldowns do not delay a fresh handler.
    if (timer) {
      clearTimeout(timer);
    }
    timer = null;
    timerDueAt = null;
    timerKind = null;
    // Reset module-level execution state that may be stale from interrupted
    // runs in the previous lifecycle. Without this, `running === true` from
    // an interrupted heartbeat blocks all future schedule() attempts, and
    // `scheduled === true` can cause spurious immediate re-runs.
    running = false;
    scheduled = false;
  }
  if (handler && pendingWakes.size > 0) {
    schedule(DEFAULT_COALESCE_MS, "normal");
  }
  return () => {
    if (handlerGeneration !== generation) {
      return;
    }
    if (handler !== next) {
      return;
    }
    handlerGeneration += 1;
    handler = null;
  };
}

export function requestHeartbeat(opts: {
  source: HeartbeatWakeSource;
  intent: HeartbeatWakeIntent;
  reason?: string;
  coalesceMs?: number;
  agentId?: string;
  sessionKey?: string;
  heartbeat?: { target?: string };
}) {
  queuePendingWakeReason({
    source: opts.source,
    intent: opts.intent,
    reason: opts.reason,
    agentId: opts.agentId,
    sessionKey: opts.sessionKey,
    heartbeat: opts.heartbeat,
  });
  schedule(opts.coalesceMs ?? DEFAULT_COALESCE_MS, "normal");
}

export function hasHeartbeatWakeHandler() {
  return handler !== null;
}

export function hasPendingHeartbeatWake() {
  return pendingWakes.size > 0 || Boolean(timer) || scheduled;
}

async function raceWakeHandler(
  inner: Promise<HeartbeatRunResult>,
  pendingWake: PendingWakeReason,
): Promise<HeartbeatRunResult> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<HeartbeatRunResult>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(
          `heartbeat-wake: handler exceeded ${WAKE_HANDLER_TIMEOUT_MS}ms (source=${pendingWake.source} reason=${pendingWake.reason ?? ""})`,
        ),
      );
    }, WAKE_HANDLER_TIMEOUT_MS);
    timeoutHandle.unref?.();
  });
  try {
    return await Promise.race([inner, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Record the minimum heartbeat interval the runner currently expects.
 * Used by `getHeartbeatWakeHealth` to decide what "too long since last fire"
 * means. Call this from the heartbeat-runner whenever the schedule changes.
 */
export function setHeartbeatExpectedIntervalMs(ms: number | null): void {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) {
    expectedIntervalMs = null;
    return;
  }
  expectedIntervalMs = ms;
}

export type HeartbeatWakeHealth = {
  ok: boolean;
  running: boolean;
  lastWakeStartedAt: number | null;
  lastWakeCompletedAt: number | null;
  expectedIntervalMs: number | null;
  reason?: string;
};

/**
 * Liveness probe state. Returns ok=false when the wake module looks stuck:
 *   - `running` has been true longer than the per-handler watchdog cap, OR
 *   - the wake module hasn't completed a wake within 2× the expected
 *     interval (with a small grace period for fresh startup).
 *
 * Used by the gateway `/healthz/heartbeat` endpoint and the Docker
 * healthcheck so a deadlocked main loop fails health instead of looking live.
 */
export function getHeartbeatWakeHealth(): HeartbeatWakeHealth {
  const now = Date.now();
  const state: HeartbeatWakeHealth = {
    ok: true,
    running,
    lastWakeStartedAt,
    lastWakeCompletedAt,
    expectedIntervalMs,
  };
  if (running && typeof lastWakeStartedAt === "number") {
    const stuckFor = now - lastWakeStartedAt;
    if (stuckFor > WAKE_HANDLER_TIMEOUT_MS) {
      state.ok = false;
      state.reason = `wake handler stuck for ${stuckFor}ms (cap ${WAKE_HANDLER_TIMEOUT_MS}ms)`;
      return state;
    }
  }
  if (typeof expectedIntervalMs === "number" && expectedIntervalMs > 0) {
    const overdueThreshold = Math.max(
      expectedIntervalMs * 2 + WAKE_HANDLER_MIN_GRACE_MS,
      WAKE_HANDLER_MIN_GRACE_MS,
    );
    if (lastWakeCompletedAt === null) {
      // Nothing has completed yet; only complain after we're past the grace
      // window. Fresh startups need time before the first heartbeat lands.
      return state;
    }
    const age = now - lastWakeCompletedAt;
    if (age > overdueThreshold) {
      state.ok = false;
      state.reason = `last wake completed ${age}ms ago (threshold ${overdueThreshold}ms)`;
    }
  }
  return state;
}

/**
 * Production-safe reset for the wake module's `running`/`scheduled` flags
 * and pending timer. Use during config hot-reload to recover from a stuck
 * `running=true` left behind by a previously deadlocked wake handler. Unlike
 * `resetHeartbeatWakeStateForTests`, this preserves `handler` and pending
 * wake reasons so the runner can pick up immediately afterwards.
 */
export function resetHeartbeatWakeRunningState(): {
  wasRunning: boolean;
  wasStuckMs: number | null;
} {
  const wasRunning = running;
  const wasStuckMs =
    running && typeof lastWakeStartedAt === "number" ? Date.now() - lastWakeStartedAt : null;
  if (timer) {
    clearTimeout(timer);
  }
  timer = null;
  timerDueAt = null;
  timerKind = null;
  running = false;
  scheduled = false;
  lastWakeStartedAt = null;
  if (handler && pendingWakes.size > 0) {
    schedule(DEFAULT_COALESCE_MS, "normal");
  }
  return { wasRunning, wasStuckMs };
}

export function resetHeartbeatWakeStateForTests() {
  if (timer) {
    clearTimeout(timer);
  }
  timer = null;
  timerDueAt = null;
  timerKind = null;
  pendingWakes.clear();
  scheduled = false;
  running = false;
  lastWakeCompletedAt = null;
  lastWakeStartedAt = null;
  expectedIntervalMs = null;
  handlerGeneration += 1;
  handler = null;
}
