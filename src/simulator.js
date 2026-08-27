(function() {
    var ctx;
    var signal;
    var intervalId;

    // iOS Safari requires a user gesture to unlock AudioContext
    var audioUnlocked = false;
    function unlockAudio() {
        if (audioUnlocked) return;
        var tmp = new AudioContext();
        var osc = tmp.createOscillator();
        osc.connect(tmp.destination);
        osc.start(0);
        osc.stop(0.001);
        tmp.close();
        audioUnlocked = true;
    }
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });

    var AudioContext = window.AudioContext || window.webkitAudioContext;
    var protocolSelector = document.getElementById("protocol-selector");
    var optionContainer = document.getElementById("option");
    var protocols = window.TimeProtocols || {};

    // 1. Dynamically populate pill buttons based on loaded scripts
    protocolSelector.innerHTML = "";
    var firstKey = null;
    for (var key in protocols) {
        if (!firstKey) firstKey = key;
        var pill = document.createElement("button");
        pill.className = "protocol-pill";
        pill.setAttribute("data-protocol", key);
        pill.textContent = protocols[key].name;
        protocolSelector.appendChild(pill);
    }
    // Activate first pill by default
    if (firstKey) {
        var firstPill = protocolSelector.querySelector('[data-protocol="' + firstKey + '"]');
        if (firstPill) firstPill.classList.add('active');
    }

    // Handle pill activation and protocol switching via event delegation
    protocolSelector.addEventListener('click', function(e) {
        var pill = e.target.closest('.protocol-pill');
        if (!pill) return;

        // Update active pill visual state
        var pills = protocolSelector.querySelectorAll('.protocol-pill');
        pills.forEach(function(p) { p.classList.remove('active'); });
        pill.classList.add('active');

        // Rebuild option UI for the new protocol
        updateOptionUI();

        // Restart transmission if currently playing
        if (play_flag) {
            stop();
            start();
        } else {
            signal = undefined;
        }
    });

    function getCurrentProtocol() {
        var activePill = protocolSelector.querySelector('.protocol-pill.active');
        if (!activePill) return null;
        return protocols[activePill.getAttribute('data-protocol')];
    }

    // --- UPGRADED: Dynamic Option UI ---
    function updateOptionUI() {
        var protocol = getCurrentProtocol();
        optionContainer.innerHTML = ""; // Clear existing options

        if (!protocol) return;

        // Support both single optionText (BPC) and multiple options (JJY)
        var opts = [];
        if (protocol.options) {
            opts = protocol.options;
        } else if (protocol.optionText) {
            opts = [{ text: protocol.optionText }];
        }

        opts.forEach(function(opt, index) {
            var label = document.createElement("label");
            var checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "protocol-option-checkbox";

            // If the user toggles any checkbox while playing, restart the broadcast
            checkbox.addEventListener('change', function() {
                if (play_flag) {
                    stop();
                    start();
                }
            });

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(" " + opt.text));
            label.style.marginRight = "15px"; // Space out multiple checkboxes
            optionContainer.appendChild(label);
        });
    }

    function getOptionState() {
        var checkboxes = document.querySelectorAll(".protocol-option-checkbox");
        if (checkboxes.length === 0) return null;

        // Backward compatibility: If only 1 checkbox (like BPC), return a simple boolean
        if (checkboxes.length === 1) return checkboxes[0].checked;

        // If multiple checkboxes (like JJY), return an array of booleans
        var states = [];
        checkboxes.forEach(function(cb) { states.push(cb.checked); });
        return states;
    }

    // Initialize UI on load
    updateOptionUI();

    // 2. Timing and Audio Engine
    // In NTP mode, make sure the clock offset is fresh before anchoring a broadcast
    function ensureFreshSync() {
        if (TimeSource.getMode() !== 'ntp') return Promise.resolve();
        var st = TimeSource.getStatus();
        if (st.state === 'ok' && (Date.now() - st.lastSyncAt) < 60 * 1000) return Promise.resolve();
        return TimeSource.sync();
    }

    function start() {
        ctx = new AudioContext();
        var now = TimeSource.now();
        var t = Math.floor(now / (60 * 1000)) * 60 * 1000;
        var next = t + 60 * 1000;
        var delay = next - now - 1000;

        if (delay < 0) {
            t = next;
            delay += 60 * 1000;
        }

        var protocol = getCurrentProtocol();

        // Pass the checkbox state as the 3rd argument and the corrected clock as the 4th
        signal = protocol.schedule(new Date(t), ctx, getOptionState(), TimeSource.now());

        intervalId = setTimeout(function() {
            interval();
            intervalId = setInterval(interval, 60 * 1000);
        }, delay);

        function interval() {
            t += 60 * 1000;
            signal = protocol.schedule(new Date(t), ctx, getOptionState(), TimeSource.now());
        }
    }

    function stop() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        if (ctx) {
            ctx.close();
            ctx = null;
        }
        signal = undefined;
    }

    // 3. UI Controls
    var control_button = document.getElementById("control-button");
    var canvas_panel = document.getElementById("canvas-panel");
    var statusLive = document.getElementById("status-live");
    var play_flag = false;
    var btnLabel = control_button.querySelector('span');
    var btnIconPlay = document.getElementById('btn-icon-play');
    var btnIconStop = document.getElementById('btn-icon-stop');

    control_button.addEventListener('click', function() {
        if (play_flag) {
            btnLabel.textContent = "Start Transmitting";
            btnIconPlay.style.display = '';
            btnIconStop.style.display = 'none';
            play_flag = false;
            canvas_panel.classList.remove('visible');
            if (statusLive) statusLive.textContent = "Transmission stopped";
            stop();
        } else {
            btnLabel.textContent = "Stop Transmitting";
            btnIconPlay.style.display = 'none';
            btnIconStop.style.display = '';
            play_flag = true;
            canvas_panel.classList.add('visible');
            if (statusLive) statusLive.textContent = "Transmission started";
            ensureFreshSync().then(start);
        }
    });

    // 4. Rendering Engine
    var renderer = new window.SignalRenderer('canvas', function() { return signal; }, getCurrentProtocol, getOptionState);
    renderer.start();

    // Wrap start/stop to manage renderer lifecycle
    var _start = start;
    var _stop = stop;
    start = function() {
        _start();
        renderer.start();
    };
    stop = function() {
        renderer.stop();
        _stop();
    };

    // 5. Time Source UI (System time / NTP synced)
    var timeSourceRow = document.getElementById('time-source');
    var ntpStatusEl = document.getElementById('time-ntp-status');
    var ntpTextEl = document.getElementById('ntp-status-text');
    var ntpResyncBtn = document.getElementById('ntp-resync');

    function setActiveSourcePill(sourceMode) {
        var pills = timeSourceRow.querySelectorAll('.time-source-pill');
        pills.forEach(function(p) {
            var active = p.getAttribute('data-source') === sourceMode;
            p.classList.toggle('active', active);
            p.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function formatAgo(t) {
        var s = Math.max(0, Math.round((Date.now() - t) / 1000));
        if (s < 60) return s + 's ago';
        var m = Math.floor(s / 60);
        if (m < 60) return m + 'm ago';
        return Math.floor(m / 60) + 'h ago';
    }

    function renderNtpStatus() {
        var status = TimeSource.getStatus();
        var isNtp = status.mode === 'ntp';
        ntpStatusEl.hidden = !isNtp;
        if (!isNtp) return;

        var stateClass, text;
        if (status.state === 'syncing') {
            stateClass = 'ntp-syncing';
            text = 'NTP: syncing\u2026';
        } else if (status.state === 'ok') {
            stateClass = 'ntp-ok';
            var off = status.offsetMs;
            text = 'NTP \u00b7 ' + (status.endpoint || '?') + ' ' + (off >= 0 ? '+' : '') + off + ' ms \u00b1' + status.uncertaintyMs +
                   ' ms \u00b7 synced ' + formatAgo(status.lastSyncAt);
        } else if (status.state === 'error') {
            stateClass = 'ntp-error';
            text = (status.lastSyncAt && (Date.now() - status.lastSyncAt) <= 5 * 60 * 1000)
                ? 'NTP offline \u2014 using last sync'
                : 'NTP unavailable \u2014 using system time';
        } else {
            stateClass = 'ntp-syncing';
            text = 'NTP: idle';
        }
        ntpStatusEl.className = 'time-ntp-status ' + stateClass;
        ntpTextEl.textContent = text;
    }

    timeSourceRow.addEventListener('click', function(e) {
        var pill = e.target.closest('.time-source-pill');
        if (!pill) return;
        TimeSource.setMode(pill.getAttribute('data-source'));
    });

    ntpResyncBtn.addEventListener('click', function() {
        TimeSource.sync();
    });

    // Keep the "synced Xs ago" ticker current
    setInterval(renderNtpStatus, 1000);

    // Reflect the persisted mode and current status on load
    setActiveSourcePill(TimeSource.getMode());
    renderNtpStatus();

    // React to source changes / sync completions. Offsets self-correct at the
    // next minute boundary (schedule() is re-anchored every minute), so only a
    // mode switch needs to restart the broadcast.
    var lastSourceMode = TimeSource.getMode();
    TimeSource.onChange(function(status) {
        setActiveSourcePill(status.mode);
        renderNtpStatus();
        if (status.mode !== lastSourceMode) {
            lastSourceMode = status.mode;
            if (play_flag) {
                var ready = (status.mode === 'ntp') ? TimeSource.sync() : Promise.resolve();
                ready.then(function() {
                    if (play_flag) {
                        stop();
                        start();
                    }
                });
            }
        }
    });
})();
