window.TimeProtocols = window.TimeProtocols || {};

window.TimeProtocols.dcf77 = (function() {
    // 19.375 kHz Sawtooth wave. The 4th harmonic hits exactly 77.5 kHz.
    // var freq = 19375; 
    // 15.500 kHz square wave. The 5th harmonic hits exactly 77.5 kHz.
    var freq = 15500;

    // Automatic calculator for Central European Summer Time (CEST)
    // Starts: Last Sunday in March at 01:00 UTC (02:00 CET)
    // Ends: Last Sunday in October at 01:00 UTC (03:00 CEST)
    function isCEST(date) {
        var year = date.getUTCFullYear();

        var startDST = new Date(Date.UTC(year, 2, 31, 1));
        startDST.setUTCDate(31 - startDST.getUTCDay()); 

        var endDST = new Date(Date.UTC(year, 9, 31, 1));
        endDST.setUTCDate(31 - endDST.getUTCDay()); 

        return date.getTime() >= startDST.getTime() && date.getTime() < endDST.getTime();
    }

    return {
        name: "DCF77 (Germany / Europe)",

        schedule: function(date_loc, ctx) {
            var isDST = isCEST(date_loc);
            
            // CET is UTC+1, CEST is UTC+2
            var offsetMs = isDST ? (2 * 60 * 60 * 1000) : (1 * 60 * 60 * 1000);
            
            // DCF77 must encode the time of the NEXT minute (+ 60,000 ms)
            var dateGer = new Date(date_loc.getTime() + offsetMs + 60000);

            var now = Date.now();
            var start = date_loc.getTime();
            var offset = (start - now) / 1000 + ctx.currentTime;

            var minute = dateGer.getUTCMinutes();
            var hour = dateGer.getUTCHours();
            var fullyear = dateGer.getUTCFullYear();
            var year = fullyear % 100;
            var month = dateGer.getUTCMonth() + 1;
            var day = dateGer.getUTCDate();
            
            // DCF77 defines Monday = 1, Sunday = 7. (JS getUTCDay is Sunday = 0)
            var week_day = dateGer.getUTCDay() || 7; 
            
            var array = [];

            var osc = ctx.createOscillator();
            osc.type = "square";
            osc.frequency.value = freq;
            
            var gainNode = ctx.createGain();
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            
            osc.connect(gainNode);
            gainNode.connect(ctx.destination);
            
            var startTime = Math.max(offset, ctx.currentTime);
            var stopTime = offset + 60.0;
            
            if (stopTime > ctx.currentTime) {
                osc.start(startTime);
                osc.stop(stopTime);
            }

            // DCF77 Carrier Modulation (Drops at the START of the second)
            // DCF77 Carrier Modulation (Drops at the START of the second)
            function emit(s, drop_duration) {
                array.push(drop_duration);
                var t = s + offset;
                if (t < 0) return;
                
                if (drop_duration > 0) {
                    gainNode.gain.setValueAtTime(0, t);
                    gainNode.gain.setValueAtTime(1, t + drop_duration);
                } else {
                    // Explicitly ensure the carrier is ON if there is no drop
                    gainNode.gain.setValueAtTime(1, t);
                }
                
                // Ensure carrier stays on until the end of the second
                gainNode.gain.setValueAtTime(1, t + 0.999);
            }

            // --- DCF77 BIT GENERATION ---
            var bits = new Array(60).fill(0);
            
            // Bits 0-14: Civil warning bits / Weather info (0)
            // Bit 15: Call bit (0)
            // Bit 16: Summer time transition warning (0)
            
            // THE FIX: Correctly map the Zone Bits
            bits[17] = isDST ? 1 : 0; // Bit 17 = 1 if CEST (Summer)
            bits[18] = isDST ? 0 : 1; // Bit 18 = 1 if CET (Winter)
            
            // Bit 19: Leap second warning (0)
            bits[20] = 1; // Start of time information (always 1)

            // Helper function to encode BCD values LSB-first
            function set_bcd(start_idx, val, units_len, tens_len) {
                var u = val % 10;
                var t = Math.floor(val / 10);
                for (var i = 0; i < units_len; i++) bits[start_idx + i] = (u >> i) & 1;
                for (var i = 0; i < tens_len; i++) bits[start_idx + units_len + i] = (t >> i) & 1;
            }

            function calc_parity(start_idx, end_idx) {
                var sum = 0;
                for (var i = start_idx; i <= end_idx; i++) sum += bits[i];
                return sum % 2; // Even parity
            }

            // Time Data Encoding
            set_bcd(21, minute, 4, 3);
            bits[28] = calc_parity(21, 27); // P1 (Minute Parity)

            set_bcd(29, hour, 4, 2);
            bits[35] = calc_parity(29, 34); // P2 (Hour Parity)

            set_bcd(36, day, 4, 2);
            
            // Weekday is a 3-bit binary number (1-7), LSB first
            for (var i = 0; i < 3; i++) bits[42 + i] = (week_day >> i) & 1;
            
            set_bcd(45, month, 4, 1);
            set_bcd(50, year, 4, 4);
            bits[58] = calc_parity(36, 57); // P3 (Date Parity)

            // --- TRANSMISSION ---
            for (var i = 0; i < 60; i++) {
                if (i === 59) {
                    // Second 59 is the minute mark: NO amplitude drop
                    emit(i, 0.0);
                } else {
                    // Bit 0 = 100ms drop. Bit 1 = 200ms drop.
                    emit(i, bits[i] ? 0.2 : 0.1);
                }
            }

            return array;
        },

        formatDate: function(date) {
            var isDST = isCEST(date);
            var dstStr = isDST ? "[CEST ON]" : "[CET (Winter)]";

            var year_utc = date.getUTCFullYear();
            var month_utc = date.getUTCMonth() + 1;
            var day_utc = date.getUTCDate();
            var hour_utc = date.getUTCHours();
            var minute_utc = date.getUTCMinutes();
            var second_utc = date.getUTCSeconds();

            var utcStr = `| UTC: ${year_utc}-${month_utc.toString().padStart(2, '0')}-${day_utc.toString().padStart(2, '0')} ` +
                         `${hour_utc.toString().padStart(2, '0')}:${minute_utc.toString().padStart(2, '0')}:${second_utc.toString().padStart(2, '0')}`;

            var offsetMs = isDST ? (2 * 60 * 60 * 1000) : (1 * 60 * 60 * 1000);
            
            // Display the current time being broadcasted (not the future minute encoded in the payload)
            var dateGer = new Date(date.getTime() + offsetMs);

            var yearGer = dateGer.getUTCFullYear();
            var monthGer = dateGer.getUTCMonth() + 1;
            var dayGer = dateGer.getUTCDate();
            var hourGer = dateGer.getUTCHours();
            var minuteGer = dateGer.getUTCMinutes();
            var secondGer = dateGer.getUTCSeconds();

            return `Germany Time (CET/CEST) ${dstStr}: ${yearGer}-${monthGer.toString().padStart(2, '0')}-${dayGer.toString().padStart(2, '0')} ` +
                   `${hourGer.toString().padStart(2, '0')}:${minuteGer.toString().padStart(2, '0')}:${secondGer.toString().padStart(2, '0')} ${utcStr}`;
        },

        drawBar: function(ctx2d, val, index, now, barX, barY, cellWidth, cellHeight) {
            if (index == now) {
                ctx2d.fillStyle = "#FF0000"; // Current second
            } else {
                if (val === 0.0) ctx2d.fillStyle = "#00FF00";      // Second 59 (No drop, fully green)
                else if (val === 0.1) ctx2d.fillStyle = "#007F00"; // Bit 0 (100ms drop)
                else if (val === 0.2) ctx2d.fillStyle = "#7F7F00"; // Bit 1 (200ms drop)
                else ctx2d.fillStyle = "#333333";
            }

            // Draw the gap on the left, and the tone on the right
            var shiftX = cellWidth * val;
            var barWidth = cellWidth * (1.0 - val); 
            ctx2d.fillRect(barX + shiftX, barY, barWidth, cellHeight);
        }
    };
})();
