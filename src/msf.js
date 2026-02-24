window.TimeProtocols = window.TimeProtocols || {};

window.TimeProtocols.msf = (function() {
    // 20 kHz square wave. The 3rd harmonic hits exactly 60 kHz.
    var freq = 20000;

    // Persistent audio nodes to prevent inter-minute gaps and clicks
    var currentCtx = null;
    var osc = null;
    var gainNode = null;

    // Automatic calculator for British Summer Time (BST)
    function isUKDST(date) {
        var year = date.getUTCFullYear();

        var startDST = new Date(Date.UTC(year, 2, 31, 1));
        startDST.setUTCDate(31 - startDST.getUTCDay());

        var endDST = new Date(Date.UTC(year, 9, 31, 1));
        endDST.setUTCDate(31 - endDST.getUTCDay());

        return date.getTime() >= startDST.getTime() && date.getTime() < endDST.getTime();
    }

    return {
        name: "MSF (United Kingdom)",

        schedule: function(date_loc, ctx) {
            var isDST = isUKDST(date_loc);
            var offsetMs = isDST ? (1 * 60 * 60 * 1000) : 0;

            // Bypass browser local timezone entirely. Calculate pure UK Time.
            // MSF must encode the time of the NEXT minute (+ 60,000 ms)
            var dateUK = new Date(date_loc.getTime() + offsetMs + 60000);

            var now = Date.now();
            var start = date_loc.getTime();
            var offset = (start - now) / 1000 + ctx.currentTime;

            var minute = dateUK.getUTCMinutes();
            var hour = dateUK.getUTCHours();
            var fullyear = dateUK.getUTCFullYear();
            var year = fullyear % 100;
            var month = dateUK.getUTCMonth() + 1;
            var day = dateUK.getUTCDate();
            var week_day = dateUK.getUTCDay(); // MSF maps Sunday to 0

            var array = [];
            var bit_count = 0;

            // Maintain a single, continuous phase-locked carrier wave
            if (ctx !== currentCtx) {
                if (osc) {
                    try { osc.stop(); } catch(e) {}
                }
                osc = ctx.createOscillator();
                osc.type = "square";
                osc.frequency.value = freq;

                gainNode = ctx.createGain();
                
                // CRITICAL FIX: Initialize to 1 (Carrier ON) so mid-second starts don't drop volume
                gainNode.gain.setValueAtTime(1, ctx.currentTime);

                osc.connect(gainNode);
                gainNode.connect(ctx.destination);

                var startTime = Math.max(offset, ctx.currentTime);
                osc.start(startTime);

                currentCtx = ctx;
            }

            // Robust Amplitude Modulation scheduling that handles mid-second starts safely
            function emit(s, drop_duration) {
                array.push(drop_duration);
                var t = s + offset;
                
                if (t >= ctx.currentTime) {
                    gainNode.gain.setValueAtTime(0, t);
                }
                if (t + drop_duration >= ctx.currentTime) {
                    gainNode.gain.setValueAtTime(1, Math.max(t + drop_duration, ctx.currentTime));
                }
                // Ensure carrier stays on until the end of the second
                if (t + 0.999 >= ctx.currentTime) {
                    gainNode.gain.setValueAtTime(1, Math.max(t + 0.999, ctx.currentTime));
                }
            }

            function bit(s, value, weight) {
                var b = value >= weight;
                value -= b ? weight : 0;

                if (b) bit_count++;

                // MSF Data Bits: 1 = 200ms drop (Bit A=1, B=0), 0 = 100ms drop (Bit A=0, B=0)
                emit(s, b ? 0.2 : 0.1);
                return value;
            }

            function get_parity() {
                var p = (bit_count % 2 === 0) ? 1 : 0;
                bit_count = 0;
                return p;
            }

            // Second 0: Minute Marker (500ms drop)
            emit(0, 0.5);

            // Seconds 1-16: DUT1 & reserved (We default to 0)
            for (var i = 1; i <= 16; i++) {
                emit(i, 0.1);
            }

            // Seconds 17-24: Year
            year = bit(17, year, 80); year = bit(18, year, 40);
            year = bit(19, year, 20); year = bit(20, year, 10);
            year = bit(21, year, 8);  year = bit(22, year, 4);
            year = bit(23, year, 2);  year = bit(24, year, 1);
            var pYear = get_parity();

            // Seconds 25-29: Month
            month = bit(25, month, 10); month = bit(26, month, 8);
            month = bit(27, month, 4);  month = bit(28, month, 2);
            month = bit(29, month, 1);

            // Seconds 30-35: Day of Month
            day = bit(30, day, 20); day = bit(31, day, 10);
            day = bit(32, day, 8);  day = bit(33, day, 4);
            day = bit(34, day, 2);  day = bit(35, day, 1);
            var pMonthDay = get_parity();

            // Seconds 36-38: Day of Week
            week_day = bit(36, week_day, 4);
            week_day = bit(37, week_day, 2);
            week_day = bit(38, week_day, 1);
            var pWeekDay = get_parity();

            // Seconds 39-44: Hour
            hour = bit(39, hour, 20); hour = bit(40, hour, 10);
            hour = bit(41, hour, 8);  hour = bit(42, hour, 4);
            hour = bit(43, hour, 2);  hour = bit(44, hour, 1);

            // Seconds 45-51: Minute
            minute = bit(45, minute, 40); minute = bit(46, minute, 20);
            minute = bit(47, minute, 10); minute = bit(48, minute, 8);
            minute = bit(49, minute, 4);  minute = bit(50, minute, 2);
            minute = bit(51, minute, 1);
            var pHourMin = get_parity();

            // MSF End-of-Minute Sequence (01111110)
            // Seconds 53-58 MUST have Bit A = 1 (minimum 200ms drop).
            // Parity and DST data is encoded on Bit B (extending the drop to 300ms if 1).

            // Second 52: Marker 0 (A=0, B=0)
            emit(52, 0.1);

            // Second 53: Summer Time Warning / Impending change (A=1, B=0)
            emit(53, 0.2);

            // Seconds 54-57: Parity Bits (A=1, B=Parity)
            emit(54, pYear ? 0.3 : 0.2);
            emit(55, pMonthDay ? 0.3 : 0.2);
            emit(56, pWeekDay ? 0.3 : 0.2);
            emit(57, pHourMin ? 0.3 : 0.2);

            // Second 58: Summer Time Active Status (A=1, B=isDST)
            emit(58, isDST ? 0.3 : 0.2);

            // Second 59: Marker 0 (A=0, B=0)
            emit(59, 0.1);

            return array;
        },

        formatDate: function(date) {
            var isDST = isUKDST(date);
            var dstStr = isDST ? "[BST ON]" : "[BST OFF]";

            var year_utc = date.getUTCFullYear();
            var month_utc = date.getUTCMonth() + 1;
            var day_utc = date.getUTCDate();
            var hour_utc = date.getUTCHours();
            var minute_utc = date.getUTCMinutes();
            var second_utc = date.getUTCSeconds();

            var utcStr = `| UTC: ${year_utc}-${month_utc.toString().padStart(2, '0')}-${day_utc.toString().padStart(2, '0')} ` +
                         `${hour_utc.toString().padStart(2, '0')}:${minute_utc.toString().padStart(2, '0')}:${second_utc.toString().padStart(2, '0')}`;

            var offsetMs = isDST ? (1 * 60 * 60 * 1000) : 0;
            var dateUK = new Date(date.getTime() + offsetMs);

            var yearUK = dateUK.getUTCFullYear();
            var monthUK = dateUK.getUTCMonth() + 1;
            var dayUK = dateUK.getUTCDate();
            var hourUK = dateUK.getUTCHours();
            var minuteUK = dateUK.getUTCMinutes();
            var secondUK = dateUK.getUTCSeconds();

            return `UK Time (GMT/BST) ${dstStr}: ${yearUK}-${monthUK.toString().padStart(2, '0')}-${dayUK.toString().padStart(2, '0')} ` +
                   `${hourUK.toString().padStart(2, '0')}:${minuteUK.toString().padStart(2, '0')}:${secondUK.toString().padStart(2, '0')} ${utcStr}`;
        },

        drawBar: function(ctx2d, val, index, now, barX, barY, cellWidth, cellHeight) {
            if (index == now) {
                ctx2d.fillStyle = "#FF0000";
            } else {
                if (val === 0.1) ctx2d.fillStyle = "#007F00";      // Bit A=0, B=0 (100ms)
                else if (val === 0.2) ctx2d.fillStyle = "#7F7F00"; // Bit A=1, B=0 (200ms)
                else if (val === 0.3) ctx2d.fillStyle = "#7F007F"; // Bit A=1, B=1 (300ms)
                else if (val === 0.5) ctx2d.fillStyle = "#7F0000"; // Minute Marker (500ms)
                else ctx2d.fillStyle = "#333333";
            }

            var shiftX = cellWidth * val;
            var barWidth = cellWidth * (1.0 - val);
            ctx2d.fillRect(barX + shiftX, barY, barWidth, cellHeight);
        }
    };
})();