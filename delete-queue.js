/* Standalone queue. No network calls are made except through injected deleteOne. */
(function (root) {
  'use strict';

  async function run(ids, options = {}) {
    if (typeof options.deleteOne !== 'function') {
      throw new TypeError('deleteOne must be a function');
    }
    const uniqueIds = Array.from(new Set(ids));
    const integer = (value, fallback, min, max) => Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
    const concurrency = integer(options.concurrency, 5, 1, 5);
    const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : 500;
    const maxRetries = integer(options.maxRetries, 3, 0, Number.MAX_SAFE_INTEGER);
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const now = options.now || Date.now;
    const states = new Map(uniqueIds.map(id => [id, 'pending']));
    let cursor = 0;
    let completed = 0;
    let fatal = null;
    let stopped = false;
    let cooldownUntil = 0;
    let cooldownSleep = null;
    // A fulfilled injected sleep counts as elapsed time even with a frozen fake now().
    // Concurrent sleeps advance to their deadlines, not by adding their durations.
    let clockFloor = now();
    const clock = () => Math.max(clockFloor, now());
    async function wait(ms) {
      if (ms <= 0) return;
      const deadline = clock() + ms;
      await sleep(ms);
      clockFloor = Math.max(clockFloor, deadline);
    }
    function notify(callback, argument) {
      // UI progress callbacks must not strand the queue if rendering fails.
      if (typeof callback === 'function') {
        try { callback(argument); } catch (_) { /* observer only */ }
      }
    }
    function asError(value) {
      if (value instanceof Error) return value;
      const error = new Error(value && value.message ? String(value.message) : String(value));
      if (value && typeof value === 'object') {
        error.status = value.status;
        error.retryAfter = value.retryAfter;
      }
      return error;
    }
    function finish(id, ok, error) {
      states.set(id, ok ? 'succeeded' : 'failed');
      completed += 1;
      notify(options.onResult, { id, ok, error: error || null, completed, total: uniqueIds.length });
    }
    function halt(error) {
      stopped = true;
      if (!fatal) fatal = error;
    }
    function cooldown(error, retryIndex) {
      let duration = NaN;
      const value = error.retryAfter;
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        const text = String(value).trim();
        if (/^\d+(?:\.\d+)?$/.test(text)) duration = Number(text) * 1000;
        else {
          const date = Date.parse(text);
          if (Number.isFinite(date)) duration = Math.max(0, date - clock());
        }
      }
      if (!Number.isFinite(duration)) duration = 2000 * Math.pow(2, Math.min(retryIndex, 30));
      cooldownUntil = Math.max(cooldownUntil, clock() + duration);
      notify(options.onCooldown, Math.max(0, cooldownUntil - clock()));
    }
    async function ready(localReady) {
      while (!stopped) {
        const current = clock();
        if (cooldownUntil > current) {
          if (!cooldownSleep) {
            const duration = cooldownUntil - current;
            cooldownSleep = wait(duration).finally(() => { cooldownSleep = null; });
          }
          await cooldownSleep;
          continue; // Another in-flight 429 may have extended the shared deadline.
        }
        if (localReady > current) {
          await wait(localReady - current);
          continue;
        }
        return true;
      }
      return false;
    }
    async function worker() {
      let localReady = 0;
      while (!stopped && cursor < uniqueIds.length) {
        const id = uniqueIds[cursor++];
        let retries = 0;
        while (!stopped) {
          if (!await ready(localReady)) return;
          // Recheck after await: an auth failure may have stopped another worker.
          if (stopped) return;
          if (cooldownUntil > clock()) continue;
          try {
            await options.deleteOne(id);
            localReady = clock() + delayMs;
            finish(id, true, null);
            break;
          } catch (value) {
            const error = asError(value);
            const status = Number(error.status);
            localReady = clock() + delayMs;
            if (status === 401 || status === 403) {
              halt(error);
              finish(id, false, error);
              break;
            }
            if (status === 429) {
              cooldown(error, retries);
              if (retries >= maxRetries) {
                halt(error);
                finish(id, false, error);
                break;
              }
              retries += 1;
              // If another worker halted, this retryable ID remains pending.
              continue;
            }
            finish(id, false, error);
            break;
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, uniqueIds.length) }, () => worker()));
    return {
      succeeded: uniqueIds.filter(id => states.get(id) === 'succeeded'),
      failed: uniqueIds.filter(id => states.get(id) === 'failed'),
      pending: uniqueIds.filter(id => states.get(id) === 'pending'),
      fatal
    };
  }

  root.CBDDeleteQueue = { run };
})(globalThis);
