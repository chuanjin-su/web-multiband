window.TimeProtocols = window.TimeProtocols || {};

window.TimeProtocols.bpc = (function() {
    var freq = 17125;

    return {
        name: "BPC (China)",

        optionText: "Use Local Time instead of CST (UTC+8)",

        schedule: function(date_loc, ctx, useLocalTime) {
            var now = Date.now();

            // CRITICAL: The audio scheduling offset MUST be calculated using
            // the un-shifted local date object, otherwise the audio will jump.
            var start = date_loc.getTime();
            var offset = (start - now) / 1000 + ctx.currentTime;

            // Determine which timezone to be used for encoding the time information
            var date;
            if (useLocalTime) {
                date = date_loc;
            } else {
                var dateUTC = new Date(date_loc.getTime() + date_loc.getTimezoneOffset() * 60 * 1000);
                date = new Date(dateUTC.getTime() + 8 * 60 * 60 * 1000);
            }

            var minute = date.getMinutes();
            var hour = date.getHours();
            var year = date.getFullYear() % 100;
            var week_day = date.getDay();
            var day = date.getDate();
            var month = date.getMonth() + 1;

            var array = [];

            var pm = (hour >= 12) ? 1 : 0;
            hour = hour % 12;

            var osc = ctx.createOscillator();
            osc.type = "sawtooth";
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

            function emit(s, drop_duration) {
                array.push(drop_duration);
                var t = s + offset;
                if (t < 0) return;

                gainNode.gain.setValueAtTime(0, t);
                gainNode.gain.setValueAtTime(1, t + drop_duration);
                gainNode.gain.setValueAtTime(1, t + 0.999);
                gainNode.gain.setValueAtTime(0, t + 1.0);
            }

            function bit(s, value) {
                var drop = 0;
                if (value === 0) drop = 0.1;
                else if (value === 1) drop = 0.2;
                else if (value === 2) drop = 0.3;
                else if (value === 3) drop = 0.4;

                emit(s, drop);
                return value;
            }

            for (var i = 0; i < 3; i++) {
                // Second 0: P0 (No signal reduction, carrier ON for full second)
                emit(i * 20, 0.0);

                // Second 1: P1 (Frame indicator: 0, 1, or 2)
                var crc = 0;
                var b = i;
                bit(1 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);

                // Second 2: P2 = 0
                b = 0;
                bit(2 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);

                // Second 3 & 4: Hour
                b = hour >> 2;
                bit(3 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);
                b = hour & 3;
                bit(4 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);

                // Second 5, 6, 7: Minute
                b = minute >> 4;
                bit(5 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);
                b = (minute >> 2) & 3;
                bit(6 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);
                b = minute & 3;
                bit(7 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);

                // Second 8, 9: Weekday
                b = week_day >> 2;
                bit(8 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);
                b = week_day & 3;
                bit(9 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);

                // Second 10: PM & CRC
                b = pm << 1;
                b = b + crc;
                bit(10 + i * 20, b);

                crc = 0;
                // Second 11, 12, 13: Day
                b = day >> 4;
                bit(11 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);
                b = (day >> 2) & 3;
                bit(12 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);
                b = day & 3;
                bit(13 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);

                // Second 14, 15: Month
                b = month >> 2;
                bit(14 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);
                b = month & 3;
                bit(15 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);

                // Second 16, 17, 18: Year
                b = (year >> 4) & 3;
                bit(16 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);
                b = (year >> 2) & 3;
                bit(17 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);
                b = year & 3;
                bit(18 + i * 20, b);
                crc = crc ^ (b & 1) ^ ((b >> 1) & 1);

                // Second 19: Year & CRC
                b = year >> 6;
                b = b + crc;
                bit(19 + i * 20, b);
            }

            return array;
        },

        formatDate: function(date, useLocalTime) {
            var year_utc = date.getUTCFullYear();
            var month_utc = date.getUTCMonth() + 1;
            var day_utc = date.getUTCDate();
            var hour_utc = date.getUTCHours();
            var minute_utc = date.getUTCMinutes();
            var second_utc = date.getUTCSeconds();

            var utcStr = `| UTC: ${year_utc}-${month_utc.toString().padStart(2, '0')}-${day_utc.toString().padStart(2, '0')} ` +
                         `${hour_utc.toString().padStart(2, '0')}:${minute_utc.toString().padStart(2, '0')}:${second_utc.toString().padStart(2, '0')}`;

            if (useLocalTime) {
                var yearLoc = date.getFullYear();
                var monthLoc = date.getMonth() + 1;
                var dayLoc = date.getDate();
                var hourLoc = date.getHours();
                var minuteLoc = date.getMinutes();
                var secondLoc = date.getSeconds();

                return `Local Time: ${yearLoc}-${monthLoc.toString().padStart(2, '0')}-${dayLoc.toString().padStart(2, '0')} ` +
                       `${hourLoc.toString().padStart(2, '0')}:${minuteLoc.toString().padStart(2, '0')}:${secondLoc.toString().padStart(2, '0')} ${utcStr}`;
            } else {
                var dateUTC = new Date(date.getTime() + date.getTimezoneOffset() * 60 * 1000);
                var dateCST = new Date(dateUTC.getTime() + 8 * 60 * 60 * 1000);

                var yearCST = dateCST.getFullYear();
                var monthCST = dateCST.getMonth() + 1;
                var dayCST = dateCST.getDate();
                var hourCST = dateCST.getHours();
                var minuteCST = dateCST.getMinutes();
                var secondCST = dateCST.getSeconds();

                return `CST (UTC+8): ${yearCST}-${monthCST.toString().padStart(2, '0')}-${dayCST.toString().padStart(2, '0')} ` +
                       `${hourCST.toString().padStart(2, '0')}:${minuteCST.toString().padStart(2, '0')}:${secondCST.toString().padStart(2, '0')} ${utcStr}`;
            }
        },

        drawBar: function(ctx2d, val, index, now, barX, barY, cellWidth, cellHeight) {
            if (index == now) {
                ctx2d.fillStyle = "#FF0000"; // Current second highlight
            } else {
                if (val === 0.0) ctx2d.fillStyle = "#00FF00";      // P0 (Full carrier)
                else if (val === 0.1) ctx2d.fillStyle = "#007F00"; // 00
                else if (val === 0.2) ctx2d.fillStyle = "#7F7F00"; // 01
                else if (val === 0.3) ctx2d.fillStyle = "#7F7F7F"; // 10
                else ctx2d.fillStyle = "#7F0000";                  // 11
            }

            // Draw width proportional to the ON duration
            var shiftX = cellWidth * val;
            var barWidth = cellWidth * (1.0 - val);
            ctx2d.fillRect(barX + shiftX, barY, barWidth, cellHeight);
        }
    };
})();
