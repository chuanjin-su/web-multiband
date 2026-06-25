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
    function start() {
        ctx = new AudioContext();
        var now = Date.now();
        var t = Math.floor(now / (60 * 1000)) * 60 * 1000;
        var next = t + 60 * 1000;
        var delay = next - now - 1000;

        if (delay < 0) {
            t = next;
            delay += 60 * 1000;
        }

        var protocol = getCurrentProtocol();

        // Pass the checkbox state as the 3rd argument
        signal = protocol.schedule(new Date(t), ctx, getOptionState());

        intervalId = setTimeout(function() {
            interval();
            intervalId = setInterval(interval, 60 * 1000);
        }, delay);

        function interval() {
            t += 60 * 1000;
            signal = protocol.schedule(new Date(t), ctx, getOptionState());
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
            start();
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
})();
