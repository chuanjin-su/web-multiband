(function() {
    var ctx;
    var signal;
    var intervalId;

    var AudioContext = window.AudioContext || window.webkitAudioContext;
    var protocolSelector = document.getElementById("protocol-selector");
    var optionContainer = document.getElementById("option");
    var protocols = window.TimeProtocols || {};

    // 1. Dynamically populate the select dropdown based on loaded scripts
    protocolSelector.innerHTML = "";
    for (var key in protocols) {
        var opt = document.createElement("option");
        opt.value = key;
        opt.textContent = protocols[key].name;
        protocolSelector.appendChild(opt);
    }

    function getCurrentProtocol() {
        return protocols[protocolSelector.value];
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
    var canvas_panel = document.getElementById("canvas-panel"); // Grab the new container ID
    var play_flag = false;

    control_button.addEventListener('click', function() {
        if (play_flag) {
            control_button.innerText = "Start Transmitting"; // Changed to match your original HTML text
            play_flag = false;
            canvas_panel.style.display = "none"; // Hide the canvas
            stop();
        } else {
            control_button.innerText = "Stop Transmitting";
            play_flag = true;
            canvas_panel.style.display = "block"; // Show the canvas
            start();
        }
    });

    protocolSelector.addEventListener('change', function() {
        updateOptionUI(); // Rebuild the checkbox if the new protocol needs it
        if (play_flag) {
            stop();
            start();
        } else {
            signal = undefined;
        }
    });

    // 4. Rendering Engine
    var nowtime = document.getElementById('time');
    var canvas = document.getElementById('canvas');
    var ctx2d = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;

    render();
    function render() {
        var protocol = getCurrentProtocol();

        if (protocol) {
            // Pass the checkbox state as the 2nd argument to formatDate
            nowtime.innerText = protocol.formatDate(new Date(), getOptionState());
        }

        ctx2d.clearRect(0, 0, w, h);
        if (!signal || !protocol) {
            requestAnimationFrame(render);
            return;
        }

        var now = Math.floor(Date.now() / 1000) % 60;

        ctx2d.strokeStyle = "#555";
        ctx2d.fillStyle = "#555";
        ctx2d.font = "12px sans-serif";
        ctx2d.beginPath();

        ctx2d.moveTo(0, 80); ctx2d.lineTo(900, 80);
        ctx2d.moveTo(0, 180); ctx2d.lineTo(900, 180);

        for (var tick = 0; tick <= 60; tick++) {
            var row = Math.floor(tick / 30);
            if (tick === 60) row = 1;

            var x = (tick % 30) * 30;
            if (tick === 60) x = 900;

            var yBase = row === 0 ? 80 : 180;

            ctx2d.moveTo(x, yBase);
            if (tick % 10 === 0) {
                ctx2d.lineTo(x, yBase + 12);
                if (tick <= 60) ctx2d.fillText(tick, x + 3, yBase + 18);
            } else if (tick % 5 === 0) {
                ctx2d.lineTo(x, yBase + 8);
            } else {
                ctx2d.lineTo(x, yBase + 5);
            }
        }
        ctx2d.stroke();

        for (var i = 0; i < signal.length; i++) {
            var val = signal[i];
            var barX = (i % 30) * 30;
            var barY = Math.floor(i / 30) * 100;

            protocol.drawBar(ctx2d, val, i, now, barX, barY, 30, 80);
        }

        requestAnimationFrame(render);
    }
})();
