/* Pure test entry point: await globalThis.CBDDeleteQueueTests.run(CBDDeleteQueue.run).
 * Load both files with new Function in a REPL. No network or dependencies.
 */
(function (root) {
  'use strict';
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const equal = (a, b, message) => assert(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const http = (status, retryAfter) => Object.assign(new Error('HTTP ' + status), { status, retryAfter });
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  function fakeClock(epoch = 0) {
    let time = epoch;
    const timers = [], sleeps = [];
    const now = () => time;
    const sleep = ms => {
      assert(ms >= 0 && Number.isFinite(ms), 'valid sleep');
      sleeps.push({ at: time, ms });
      return new Promise(resolve => timers.push({ at: time + ms, resolve }));
    };
    async function next() {
      await flush(); assert(timers.length > 0, 'expected timer');
      time = Math.min(...timers.map(t => t.at));
      for (const timer of timers.filter(t => t.at <= time)) {
        timers.splice(timers.indexOf(timer), 1); timer.resolve();
      }
      await flush();
    }
    async function settle(promise) {
      let done = false, result, failure;
      promise.then(value => { done = true; result = value; }, error => { done = true; failure = error; });
      for (let i = 0; i < 200 && !done; i++) { await flush(); if (!done) await next(); }
      assert(done, 'task settled'); if (failure) throw failure; return result;
    }
    return { now, sleep, sleeps, next, settle };
  }
  async function runTests(run) {
    const passed = [];
    async function test(name, body) { await body(); passed.push(name); }
    await test('cap5, fill5, recycle slot, deduplicate, no trailing delay', async () => {
      const c = fakeClock(), calls = []; let active = 0, peak = 0;
      const task = run(['a','b','c','d','e','f','a'], {
        concurrency: 99, delayMs: 500, now: c.now, sleep: c.sleep,
        deleteOne: async id => {
          active++; peak = Math.max(peak, active);
          const release = deferred(); calls.push({ id, at: c.now(), release });
          await release.promise; active--;
        }
      });
      await flush(); equal(calls.map(r => r.id), ['a','b','c','d','e'], 'five initial slots');
      calls[1].release.resolve(); await flush(); assert(calls.length === 5, 'delay before refill');
      await c.next(); assert(calls.length === 6 && calls[5].at === 500, 'released slot refilled at 500ms');
      for (const call of calls) call.release.resolve();
      const result = await c.settle(task);
      assert(peak === 5, 'peak exactly five');
      equal(result, { succeeded: ['a','b','c','d','e','f'], failed: [], pending: [], fatal: null, aborted: false }, 'unique results');
      equal(c.sleeps.map(s => s.ms), [500], 'no final waits');
    });
    await test('HTTP/network accounting and progress, keep going', async () => {
      const c = fakeClock(), events = [];
      const result = await c.settle(run(['ok','http','network','last','ok'], {
        concurrency: 1, delayMs: 500, now: c.now, sleep: c.sleep,
        deleteOne: async id => { if (id === 'http') throw http(500); if (id === 'network') throw new Error('offline'); },
        onResult: event => events.push(event)
      }));
      equal(result.succeeded, ['ok','last'], 'successes'); equal(result.failed, ['http','network'], 'failures');
      equal(result.pending, [], 'nothing pending'); assert(result.fatal === null, 'not fatal');
      equal(events.map(e => [e.id,e.ok,e.completed,e.total]), [['ok',true,1,4],['http',false,2,4],['network',false,3,4],['last',true,4,4]], 'progress');
      assert(events[1].error instanceof Error && events[0].error === null, 'progress errors');
      equal(c.sleeps.map(s => s.ms), [500,500,500], 'no trailing wait');
    });
    await test('shared 429 cooldown Retry-After seconds', async () => {
      const c = fakeClock(), calls = [], notices = []; let a = 0;
      const result = await c.settle(run(['a','b','c','d'], {
        concurrency: 2, delayMs: 500, now: c.now, sleep: c.sleep,
        deleteOne: async id => {
          calls.push({ id, at: c.now() });
          if (id === 'a' && a++ === 0) throw http(429, '3');
          if (id === 'b') await c.sleep(100);
        }, onCooldown: ms => notices.push(ms)
      }));
      assert(calls.length === 5 && calls.slice(2).every(r => r.at >= 3000), 'all subsequent requests obey cooldown');
      assert(calls.filter(r => r.id === 'a')[1].at === 3000, 'retry at deadline');
      equal(notices, [3000], 'cooldown notice'); equal(result.succeeded, ['a','b','c','d'], 'all succeeded');
    });
    await test('Retry-After HTTP date', async () => {
      const epoch = Date.parse('2026-01-01T00:00:00Z'), c = fakeClock(epoch), calls = [];
      const result = await c.settle(run(['date'], {
        now: c.now, sleep: c.sleep,
        deleteOne: async () => { calls.push(c.now()); if (calls.length === 1) throw http(429, new Date(epoch + 7000).toUTCString()); }
      }));
      equal(calls, [epoch,epoch+7000], 'date deadline'); equal(result.succeeded, ['date'], 'date success');
    });
    await test('concurrent 429 extends shared cooldown', async () => {
      const c = fakeClock(), calls = [], attempts = {};
      const result = await c.settle(run(['a','b','c'], {
        concurrency: 2, delayMs: 0, now: c.now, sleep: c.sleep,
        deleteOne: async id => {
          calls.push({ id, at: c.now() }); attempts[id] = (attempts[id] || 0) + 1;
          if (id === 'a' && attempts[id] === 1) throw http(429, '2');
          if (id === 'b' && attempts[id] === 1) { await c.sleep(1000); throw http(429, '5'); }
        }
      }));
      assert(calls.slice(2).every(r => r.at >= 6000), 'extended deadline blocks all work');
      equal(result.succeeded, ['a','b','c'], 'recovered');
    });
    await test('2/4/8 exponential backoff, 3 retries, halt after exhaustion', async () => {
      const c = fakeClock(), calls = [], notices = [];
      const result = await c.settle(run(['limited','queued'], {
        concurrency: 1, now: c.now, sleep: c.sleep,
        deleteOne: async id => { calls.push({ id, at: c.now() }); throw http(429); },
        onCooldown: ms => notices.push(ms)
      }));
      equal(calls.map(r => r.at), [0,2000,6000,14000], 'three retries');
      equal(notices, [2000,4000,8000,16000], 'backoff notices');
      equal(result.failed, ['limited'], 'exhausted failed'); equal(result.pending, ['queued'], 'queue halted');
      assert(result.fatal instanceof Error && result.fatal.status === 429, 'fatal 429');
      equal(c.sleeps.map(s => s.ms), [2000,4000,8000], 'no wait after exhaustion');
    });
    for (const status of [401,403]) {
      await test('auth ' + status + ' stops queued work, drains in-flight', async () => {
        const c = fakeClock(), calls = [], release = deferred();
        const task = run(['auth','inflight','q1','q2'], {
          concurrency: 2, now: c.now, sleep: c.sleep,
          deleteOne: async id => { calls.push(id); if (id === 'auth') throw http(status); await release.promise; }
        });
        await flush(); equal(calls, ['auth','inflight'], 'only initial requests');
        release.resolve(); const result = await c.settle(task);
        equal(result.succeeded, ['inflight'], 'drained success'); equal(result.failed, ['auth'], 'auth failed');
        equal(result.pending, ['q1','q2'], 'queued pending'); assert(result.fatal instanceof Error && result.fatal.status === status, 'fatal auth');
        equal(c.sleeps, [], 'no pointless waits');
      });
    }
    await test('auth stops claimed but not started IDs', async () => {
      const c = fakeClock(), calls = [];
      const result = await c.settle(run(['quick','auth','claimed','queued'], {
        concurrency: 2, delayMs: 500, now: c.now, sleep: c.sleep,
        deleteOne: async id => { calls.push(id); if (id === 'auth') { await c.sleep(100); throw http(401); } }
      }));
      equal(calls, ['quick','auth'], 'no late request'); equal(result.pending, ['claimed','queued'], 'both pending');
    });
    await test('frozen clock and instant fake sleep cannot loop forever', async () => {
      let count = 0; const sleeps = [];
      const result = await run(['one','two'], {
        concurrency: 1, now: () => 0,
        sleep: async ms => { sleeps.push(ms); assert(sleeps.length < 10, 'no spin'); },
        deleteOne: async id => { count++; if (id === 'one' && count === 1) throw http(429, '2'); }
      });
      equal(result.succeeded, ['one','two'], 'completed'); equal(sleeps, [2000,500], 'logical clock advancement');
    });
    await test('empty, singleton, custom maxRetries zero', async () => {
      const sleeps = []; let calls = 0;
      const options = { sleep: async ms => sleeps.push(ms), deleteOne: async () => { calls++; } };
      equal(await run([], options), { succeeded: [], failed: [], pending: [], fatal: null, aborted: false }, 'empty');
      await run(['one'], options); assert(calls === 1 && sleeps.length === 0, 'singleton no sleep');
      const result = await run(['a','b'], { ...options, concurrency: 1, maxRetries: 0, deleteOne: async () => { throw http(429); } });
      equal(result.failed, ['a'], 'zero retries'); equal(result.pending, ['b'], 'rest pending');
    });
    await test('429 exhaustion drains in-flight and preserves pending IDs', async () => {
      const c = fakeClock(), calls = [], release = deferred();
      const task = run(['limit','inflight','q1','q2'], {
        concurrency: 2, maxRetries: 0, now: c.now, sleep: c.sleep,
        deleteOne: async id => { calls.push(id); if (id === 'limit') throw http(429); await release.promise; }
      });
      await flush(); equal(calls, ['limit','inflight'], 'only initial requests after exhaustion');
      release.resolve(); const result = await c.settle(task);
      equal(result.succeeded, ['inflight'], 'in-flight success retained');
      equal(result.failed, ['limit'], 'exhausted failed'); equal(result.pending, ['q1','q2'], 'rest pending');
      assert(result.fatal.status === 429, 'fatal rate limit'); equal(c.sleeps, [], 'no wait after exhaustion');
    });
    await test('plain-object errors, invalid Retry-After, observer exceptions', async () => {
      const c = fakeClock(), calls = [];
      const result = await c.settle(run(['retry','bad','ok'], {
        concurrency: 1, delayMs: 0, now: c.now, sleep: c.sleep,
        deleteOne: async id => {
          calls.push({ id, at: c.now() });
          if (id === 'retry' && calls.length === 1) throw { status: '429', retryAfter: 'invalid', message: 'limited' };
          if (id === 'bad') throw { status: 502, message: 'gateway' };
        },
        onResult: () => { throw new Error('render failed'); },
        onCooldown: () => { throw new Error('render failed'); }
      }));
      equal(calls.map(r => r.at), [0,2000,2000,2000], 'invalid header uses fallback');
      equal(result.succeeded, ['retry','ok'], 'observer failures do not break queue');
      equal(result.failed, ['bad'], 'plain HTTP failure'); assert(result.fatal === null, 'nonfatal');
    });
    await test('abort stops queued work, drains in-flight, ends cooldown waits', async () => {
      const c = fakeClock(), calls = [], release = deferred(), controller = new AbortController();
      const task = run(['a','inflight','q1','q2'], {
        concurrency: 2, delayMs: 500, now: c.now, sleep: c.sleep, signal: controller.signal,
        deleteOne: async id => { calls.push(id); if (id === 'inflight') await release.promise; }
      });
      await flush(); equal(calls, ['a','inflight'], 'initial requests');
      controller.abort(); release.resolve();
      const result = await c.settle(task);
      equal(calls, ['a','inflight'], 'no request after abort');
      equal(result.succeeded, ['a','inflight'], 'in-flight finishes'); equal(result.pending, ['q1','q2'], 'rest pending');
      assert(result.aborted === true && result.fatal === null, 'aborted, not fatal');

      const limited = new AbortController(), tries = [];
      const waiting = run(['x','y'], {
        concurrency: 1, now: c.now, sleep: c.sleep, signal: limited.signal,
        deleteOne: async id => { tries.push(id); throw http(429, '60'); }
      });
      await flush(); limited.abort();
      const stopped = await Promise.race([waiting, flush().then(() => 'still waiting')]);
      assert(stopped !== 'still waiting', 'a 60 s cooldown ends on abort');
      equal(tries, ['x'], 'no retry after abort'); equal(stopped.pending, ['x','y'], 'retrying and queued stay pending');

      const early = new AbortController(); early.abort(); let none = 0;
      const skipped = await run(['p'], { signal: early.signal, deleteOne: async () => { none++; } });
      assert(none === 0 && skipped.aborted && skipped.pending.length === 1, 'already-aborted signal sends nothing');
    });
    return { passed: passed.length, failed: 0, tests: passed };
  }
  root.CBDDeleteQueueTests = { run: runTests };
})(globalThis);
