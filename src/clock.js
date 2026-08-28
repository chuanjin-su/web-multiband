// TimeSource: selectable clock for the simulator.
//
// Modes:
//   'system' — use the local device clock (Date.now()) directly.
//   'ntp'    — estimate the local clock offset against NTP-synced HTTPS
//              endpoints (browsers cannot send raw NTP/UDP packets), using an
//              NTP-style round-trip algorithm: offset = server_ts + rtt/2 - t3.
//              The best (minimum-RTT) sample of several wins.
//
// API:
//   TimeSource.now()          ms epoch, corrected when in NTP mode
//   TimeSource.date()         new Date(TimeSource.now())
//   TimeSource.setMode('system' | 'ntp')
//   TimeSource.getMode()
//   TimeSource.getStatus()    { state, offsetMs, uncertaintyMs, lastSyncAt, endpoint }
//   TimeSource.sync()         Promise; force a sync (NTP mode only)
//   TimeSource.onChange(cb)   notified on mode change / resync completion
//   TimeSource._endpoints     exposed for ad-hoc console testing of parsers
window.TimeSource = (function() {
    var MODE_KEY = 'wwvb.timeSource';
    var SAMPLES = 5;                       // samples per sync
    var MAX_RTT = 1000;                    // reject samples slower than 1 s
    var PROBE_TIMEOUT = 4000;              // per-request abort timeout (ms)
    var MAX_STALE = 5 * 60 * 1000;         // max age of a usable offset

    var mode = 'system';
    var offset = 0;        // ms to add to Date.now() in NTP mode
    var uncertainty = 0;   // rtt/2 of best sample (ms)
    var lastSyncAt = 0;    // Date.now() of last successful sync
    var state = 'idle';    // 'idle' | 'syncing' | 'ok' | 'error'
    var endpoint = null;   // name of the endpoint that produced the offset
    var listeners = [];
    var syncing = null;    // in-flight sync promise

    // Restore persisted mode
    try {
        var saved = localStorage.getItem(MODE_KEY);
        if (saved === 'ntp' || saved === 'system') mode = saved;
    } catch (e) { /* private mode etc. — default to system */ }

    // --- Endpoints (tried in order; all CORS-enabled, NTP-synced) ---
    // The first three return millisecond-precision payloads; Akamai and the
    // CDN endpoints below are second-precision (declared via quantumMs, and
    // their timestamps centered within the second).
    // Note: an HTTP `Date` header is only readable cross-origin when the
    // server sends `Access-Control-Expose-Headers` explicitly — jsDelivr and
    // unpkg both send `*`, which is what those two fallbacks rely on.
    // (Verified empirically: both CDNs stamp `Date` at edge response time
    // even when serving a long-cached asset.)
    var endpoints = [
        {
            name: 'cloudflare-trace',
            url: 'https://www.cloudflare.com/cdn-cgi/trace',
            // "... \nts=1715608215.123\n..." → epoch ms
            parse: function(text) {
                var m = /(?:^|\n)ts=(\d+)\.(\d+)/.exec(text);
                if (!m) throw new Error('cloudflare: no ts field');
                return parseInt(m[1], 10) * 1000 + parseInt((m[2] + '00').slice(0, 3), 10);
            }
        },
        {
            name: 'timeapi.io',
            url: 'https://timeapi.io/api/Time/current/zone?timeZone=UTC',
            // {"dateTime":"2024-05-13T14:30:15.1234567", ...} (UTC zone)
            parse: function(text) {
                var data = JSON.parse(text);
                var m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d+)/.exec(data.dateTime || '');
                if (!m) throw new Error('timeapi: unexpected payload');
                return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) +
                       parseInt((m[7] + '00').slice(0, 3), 10);
            }
        },
        {
            name: 'worldtimeapi',
            url: 'https://worldtimeapi.org/api/timezone/Etc/UTC',
            // {"utc_datetime":"2024-05-13T14:30:15.123456+00:00", ...}
            parse: function(text) {
                var data = JSON.parse(text);
                var m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d+)/.exec(data.utc_datetime || '');
                if (!m) throw new Error('worldtimeapi: unexpected payload');
                return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) +
                       parseInt((m[7] + '00').slice(0, 3), 10);
            }
        },
        {
            name: 'akamai',
            url: 'https://time.akamai.com/?iso',
            quantumMs: 1000, // response is usually whole-second
            // ISO text, fractional seconds are optional:
            // "2024-05-13T14:30:15.123Z" or "2024-05-13T14:30:15Z" (second precision)
            parse: function(text) {
                var m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(text);
                if (!m) throw new Error('akamai: unexpected payload');
                // No fraction → center the timestamp within its second
                var ms = m[7] ? parseInt((m[7] + '00').slice(0, 3), 10) : 500;
                return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + ms;
            }
        },
        {
            name: 'jsdelivr',
            url: 'https://cdn.jsdelivr.net/npm/jquery@3.7.1/package.json',
            quantumMs: 1000, // Date header is whole-second
            // The file body is irrelevant; the `Date` response header is
            // stamped by the edge at serve time and exposed to scripts via
            // `Access-Control-Expose-Headers: *`.
            parseResponse: function(resp) {
                var d = resp.headers.get('date');
                if (!d) throw new Error('jsdelivr: no date header');
                var ms = Date.parse(d);
                if (!isFinite(ms)) throw new Error('jsdelivr: bad date header');
                return ms + 500; // center within the second
            }
        },
        {
            name: 'unpkg',
            url: 'https://unpkg.com/jquery@3.7.1/package.json',
            quantumMs: 1000,
            parseResponse: function(resp) {
                var d = resp.headers.get('date');
                if (!d) throw new Error('unpkg: no date header');
                var ms = Date.parse(d);
                if (!isFinite(ms)) throw new Error('unpkg: bad date header');
                return ms + 500;
            }
        }
    ];

    function getStatus() {
        return {
            mode: mode,
            state: state,
            offsetMs: Math.round(offset),
            uncertaintyMs: Math.round(uncertainty),
            lastSyncAt: lastSyncAt,
            endpoint: endpoint
        };
    }

    function notify() {
        var status = getStatus();
        listeners.forEach(function(cb) {
            try { cb(status); } catch (e) { /* listener errors must not break sync */ }
        });
    }

    function onChange(cb) {
        if (typeof cb === 'function') listeners.push(cb);
    }

    // --- Core time access ---
    function now() {
        if (mode !== 'ntp') return Date.now();
        // Use the corrected clock only while the offset is fresh enough.
        if (lastSyncAt && (Date.now() - lastSyncAt) <= MAX_STALE) {
            return Date.now() + offset;
        }
        return Date.now(); // stale/never-synced → fall back to system time
    }

    function date() {
        return new Date(now());
    }

    // --- Sync engine ---
    function probe(ep) {
        var t0 = Date.now();
        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        var timedOut = false;
        var timer = setTimeout(function() {
            timedOut = true;
            if (ctrl) ctrl.abort();
        }, PROBE_TIMEOUT);

        return fetch(ep.url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
            .then(function(resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                var read = ep.parseResponse
                    ? ep.parseResponse(resp)
                    : resp.text().then(function(text) { return ep.parse(text); });
                return read.then(function(serverMs) {
                    clearTimeout(timer);
                    var t3 = Date.now();
                    var rtt = t3 - t0;
                    if (!(serverMs > 0)) throw new Error('invalid server time');
                    if (rtt > MAX_RTT) throw new Error('rtt too high: ' + rtt + 'ms');
                    return { rtt: rtt, offset: serverMs + rtt / 2 - t3, quantum: ep.quantumMs || 0 };
                });
            })
            .then(null, function(err) {
                // Downstream handler so parse errors also clear the timer
                clearTimeout(timer);
                throw timedOut ? new Error('probe timeout') : err;
            });
    }

    function syncEndpoint(ep) {
        var best = null;
        var attempts = 0;
        function attempt() {
            if (attempts >= SAMPLES) {
                return best ? Promise.resolve(best)
                            : Promise.reject(new Error('no valid samples from ' + ep.name));
            }
            attempts++;
            return probe(ep).then(function(sample) {
                if (!best || sample.rtt < best.rtt) best = sample;
                return attempt();
            }, function() {
                return attempt(); // tolerate individual sample failures
            });
        }
        return attempt();
    }

    function sync() {
        if (mode !== 'ntp') return Promise.resolve(getStatus());
        if (syncing) return syncing;

        state = 'syncing';
        notify();

        // Try endpoints in order until one yields a min-RTT sample.
        var chain = Promise.reject(new Error('boot'));
        endpoints.forEach(function(ep) {
            chain = chain.catch(function() {
                return syncEndpoint(ep).then(function(best) {
                    return { best: best, ep: ep };
                });
            });
        });

        function settle() { syncing = null; }

        syncing = chain.then(function(result) {
            offset = result.best.offset;
            uncertainty = result.best.rtt / 2 + (result.best.quantum || 0) / 2;
            lastSyncAt = Date.now();
            endpoint = result.ep.name;
            state = 'ok';
            notify();
            settle();
            return getStatus();
        }, function() {
            state = 'error';
            notify();
            settle();
            return getStatus();
        });

        return syncing;
    }

    function setMode(m) {
        if (m !== 'system' && m !== 'ntp') return;
        if (m === mode) return;

        mode = m;
        try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* non-fatal */ }

        if (m === 'ntp') {
            sync();
        } else {
            state = 'idle';
        }
        notify();
    }

    // Resync is user-initiated only: the "resync" button and switching from
    // system time back to NTP (setMode('ntp') above). No automatic resync on
    // tab focus, network reconnect, or a background timer.

    // Kick off a sync at load if the persisted mode is NTP
    if (mode === 'ntp') sync();

    return {
        now: now,
        date: date,
        setMode: setMode,
        getMode: function() { return mode; },
        getStatus: getStatus,
        sync: sync,
        onChange: onChange,
        _endpoints: endpoints // for ad-hoc parser testing in the console
    };
})();
