window.TimeProtocols = window.TimeProtocols || {};

window.TimeProtocols.wwvb = (function() {
    var freq = 20000; // 20 kHz

    function isUSDST(date) {
        var year = date.getUTCFullYear();
        var startDST = new Date(Date.UTC(year, 2, 1));
        var daysToSunday = (7 - startDST.getUTCDay()) % 7;
        startDST.setUTCDate(1 + daysToSunday + 7);
        startDST.setUTCHours(7);

        var endDST = new Date(Date.UTC(year, 10, 1));
        daysToSunday = (7 - endDST.getUTCDay()) % 7;
        endDST.setUTCDate(1 + daysToSunday);
        endDST.setUTCHours(6);

        return date.getTime() >= startDST.getTime() && date.getTime() < endDST.getTime();
    }

    return {
        name: "WWVB (North America)",

        schedule: function(date, ctx) {
            var now = Date.now();
            var start = date.getTime();
            var offset = (start - now) / 1000 + ctx.currentTime;

            var minute = date.getUTCMinutes();
            var hour = date.getUTCHours();
            var fullyear = date.getUTCFullYear();
            var year = fullyear % 100;
            var startOfYear = new Date(Date.UTC(fullyear, 0, 1));
            var year_day = Math.floor((date.getTime() - startOfYear.getTime()) / (24*60*60*1000)) + 1;
            var isLeapYear = ((fullyear % 4 === 0 && fullyear % 100 !== 0) || fullyear % 400 === 0) ? 1 : 0;
            var summer_time = isUSDST(date);
            var array = [];

            function emit(s, drop_duration) {
                array.push(drop_duration); // Store OFF duration
                var t = s + offset;
                if (t < 0) return;
                var osc = ctx.createOscillator();
                osc.type = "square";
                osc.frequency.value = freq;
                osc.start(t + drop_duration);
                osc.stop(t + 1.0);
                osc.connect(ctx.destination);
            }

            function marker(s) { emit(s, 0.8); }
            function zero(s)   { emit(s, 0.2); }
            function one(s)    { emit(s, 0.5); }

            function bit(s, value, weight) {
                var b = value >= weight;
                value -= b ? weight : 0;
                b ? one(s) : zero(s);
                return value;
            }

            marker(0);
            minute = bit(1, minute, 40); minute = bit(2, minute, 20);
            minute = bit(3, minute, 10); zero(4);
            minute = bit(5, minute, 8);  minute = bit(6, minute, 4);
            minute = bit(7, minute, 2);  minute = bit(8, minute, 1);
            marker(9);

            zero(10); zero(11);
            hour = bit(12, hour, 20); hour = bit(13, hour, 10);
            zero(14);
            hour = bit(15, hour, 8);  hour = bit(16, hour, 4);
            hour = bit(17, hour, 2);  hour = bit(18, hour, 1);
            marker(19);

            zero(20); zero(21);
            year_day = bit(22, year_day, 200); year_day = bit(23, year_day, 100);
            zero(24);
            year_day = bit(25, year_day, 80);  year_day = bit(26, year_day, 40);
            year_day = bit(27, year_day, 20);  year_day = bit(28, year_day, 10);
            marker(29);

            year_day = bit(30, year_day, 8); year_day = bit(31, year_day, 4);
            year_day = bit(32, year_day, 2); year_day = bit(33, year_day, 1);
            zero(34); zero(35); zero(36); zero(37); zero(38);
            marker(39);

            zero(40); zero(41); zero(42); zero(43); zero(44);
            year = bit(45, year, 80); year = bit(46, year, 40);
            year = bit(47, year, 20); year = bit(48, year, 10);
            marker(49);

            year = bit(50, year, 8); year = bit(51, year, 4);
            year = bit(52, year, 2); year = bit(53, year, 1);
            zero(54);
            isLeapYear ? one(55) : zero(55);
            zero(56);
            summer_time ? one(57) : zero(57);
            summer_time ? one(58) : zero(58);
            marker(59);

            return array;
        },

        formatDate: function(date) {
            var year_local = date.getFullYear();
            var month_local = date.getMonth() + 1;
            var day_local = date.getDate();
            var hour_local = date.getHours();
            var minute_local = date.getMinutes();
            var second_local = date.getSeconds();
            var tz_local = -date.getTimezoneOffset() / 60;

            var year_utc = date.getUTCFullYear();
            var month_utc = date.getUTCMonth() + 1;
            var day_utc = date.getUTCDate();
            var hour_utc = date.getUTCHours();
            var minute_utc = date.getUTCMinutes();
            var second_utc = date.getUTCSeconds();

            var dstStatus = isUSDST(date) ? "DST ON" : "DST OFF";

            return `Local (UTC${tz_local >= 0 ? '+' : ''}${tz_local}): ${year_local}-${month_local.toString().padStart(2, '0')}-${day_local.toString().padStart(2, '0')} ` +
                   `${hour_local.toString().padStart(2, '0')}:${minute_local.toString().padStart(2, '0')}:${second_local.toString().padStart(2, '0')} ` +
                   `| UTC: ${year_utc}-${month_utc.toString().padStart(2, '0')}-${day_utc.toString().padStart(2, '0')} ` +
                   `${hour_utc.toString().padStart(2, '0')}:${minute_utc.toString().padStart(2, '0')}:${second_utc.toString().padStart(2, '0')}` +
                   ` | ${dstStatus}`;
        },

        drawBar: function(ctx2d, val, index, now, barX, barY, cellWidth, cellHeight) {
            if (val < 0.3) ctx2d.fillStyle = (index == now) ? "#00FF00" : "#007F00";
            else if (val < 0.7) ctx2d.fillStyle = (index == now) ? "#FFFF00" : "#7F7F00";
            else ctx2d.fillStyle = (index == now) ? "#FF0000" : "#7F0000";

            // WWVB uses "drop duration" logic (shift right)
            var shiftX = cellWidth * val;
            var barWidth = cellWidth * (1 - val);
            ctx2d.fillRect(barX + shiftX, barY, barWidth, cellHeight);
        }
    };
})();
