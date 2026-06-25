window.SignalRenderer = (function() {
    function SignalRenderer(canvasId, getSignalFn, getProtocolFn, getOptionStateFn) {
        this.canvas = document.getElementById(canvasId);
        this.ctx2d = this.canvas.getContext('2d');
        this.elPrimary = document.getElementById('time-primary');
        this.elSecondary = document.getElementById('time-secondary');
        this.elBadges = document.getElementById('time-badges');
        this.getSignal = getSignalFn;
        this.getProtocol = getProtocolFn;
        this.getOptionState = getOptionStateFn || function() { return null; };
        this.w = this.canvas.width;
        this.h = this.canvas.height;

        var self = this;
        this._render = function() { self.render(); };
    }

    SignalRenderer.prototype.start = function() {
        this._rafId = requestAnimationFrame(this._render);
    };

    SignalRenderer.prototype.stop = function() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    };

    SignalRenderer.prototype.updateTimeDisplay = function() {
        var protocol = this.getProtocol();
        if (!protocol) {
            this.elPrimary.textContent = '--:--:--';
            this.elSecondary.textContent = 'Select a protocol';
            this.elBadges.innerHTML = '';
            return;
        }

        var raw = protocol.formatDate(new Date(), this.getOptionState());
        var parts = raw.split('|').map(function(s) { return s.trim(); });

        // First segment: primary time (e.g. "Local (UTC+8): 2026-06-25 14:30:15")
        var primary = parts[0] || raw;
        // Extract time portion for large display, keep label as subtitle
        var colonIdx = primary.indexOf(':');
        var label = '';
        var time = primary;
        if (colonIdx > 0 && primary.indexOf(':', colonIdx + 1) > 0) {
            // Find the split between label and HH:MM:SS
            var timeMatch = primary.match(/(\d{2}:\d{2}:\d{2})/);
            if (timeMatch) {
                time = timeMatch[1];
                label = primary.substring(0, primary.indexOf(time)).replace(/:$/, '').trim();
            }
        }
        this.elPrimary.textContent = time;
        this.elSecondary.textContent = label;

        // Badges: UTC info + extra status
        var badges = [];
        for (var i = 1; i < parts.length; i++) {
            var p = parts[i];
            if (p) {
                // Detect UTC or status-like strings
                var span = document.createElement('span');
                span.className = p.toLowerCase().indexOf('utc') >= 0 ? 'badge badge-utc' : 'badge';
                span.textContent = p;
                badges.push(span.outerHTML);
            }
        }
        this.elBadges.innerHTML = badges.join('');
    };

    SignalRenderer.prototype.render = function() {
        var protocol = this.getProtocol();
        var signal = this.getSignal();
        var ctx2d = this.ctx2d;
        var w = this.w;
        var h = this.h;

        this.updateTimeDisplay();

        ctx2d.clearRect(0, 0, w, h);

        if (!signal || !protocol) {
            this._rafId = requestAnimationFrame(this._render);
            return;
        }

        var now = Math.floor(Date.now() / 1000) % 60;

        // Grid lines
        ctx2d.strokeStyle = '#94a3b8';
        ctx2d.fillStyle = '#94a3b8';
        ctx2d.font = '11px "Inter", -apple-system, sans-serif';
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
                if (tick <= 60) ctx2d.fillText(tick, x + 3, yBase + 26);
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

        // Progress line for current second
        if (now < 60) {
            var row2 = Math.floor(now / 30);
            var curX = (now % 30) * 30;
            var curY = row2 * 100;
            var progress = (Date.now() % 1000) / 1000;
            var lineX = curX + progress * 30;

            ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx2d.lineWidth = 2;
            ctx2d.beginPath();
            ctx2d.moveTo(lineX, curY);
            ctx2d.lineTo(lineX, curY + 80);
            ctx2d.stroke();
            ctx2d.lineWidth = 1;
        }

        this._rafId = requestAnimationFrame(this._render);
    };

    return SignalRenderer;
})();
