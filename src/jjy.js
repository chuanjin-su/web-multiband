window.TimeProtocols = window.TimeProtocols || {};

window.TimeProtocols.jjy = (function() {
    var freq = 13333; // 13.333 kHz
    var plus_leapsecond_list = [
        new Date(2017, 0, 1, 9)
    ];

    function getleapsecond() {
        var now = Date.now();
        for(var i = 0; i < plus_leapsecond_list.length; i++) {
            var diff = plus_leapsecond_list[i] - now;
            if (diff > 0 && diff <= 31*24*60*60*1000) return 1;
        }
        return 0;
    }

    return {
        name: "JJY (Japan)",

        options: [
            { text: "Use Local Time instead of JST" },
            { text: "Enable DST" }
        ],

        schedule: function(date_loc, ctx, optStates) {
            // optStates is an array of booleans mapped to our checkboxes above
            var useLocalTime = optStates ? optStates[0] : false;
            var useDST = optStates ? optStates[1] : false;

            // Calculate JST (UTC+9) or use local time based on the option
            var date;
            if (useLocalTime) {
                date = date_loc;
            } else {
                var dateUTC = new Date(date_loc.getTime() + date_loc.getTimezoneOffset() * 60 * 1000);
                date = new Date(dateUTC.getTime() + 9 * 60 * 60 * 1000);
            }

            var now = Date.now();

            // Audio offset must ALWAYS be tied to the local machine's tick, not the shifted timezone
            var start = date_loc.getTime();
            var offset = (start - now) / 1000 + ctx.currentTime;

            var minute = date.getMinutes();
            var hour = date.getHours();
            var fullyear = date.getFullYear();
            var year = fullyear % 100;
            var week_day = date.getDay();

            // Safely calculate day of the year avoiding timezone drift
            var year_day = Math.floor((new Date(fullyear, date.getMonth(), date.getDate()).getTime() - new Date(fullyear, 0, 1).getTime()) / (24*60*60*1000)) + 1;

            var array = [];
            var leapsecond = getleapsecond();
            var summer_time = useDST; // Map the DST checkbox directly to JJY's logic

            function marker(s) {
                array.push(0.2); // Store ON duration
                var t = s + offset;
                if (t < 0) return;
                var osc = ctx.createOscillator();
                osc.type = "square";
                osc.frequency.value = freq;
                osc.start(t);
                osc.stop(t + 0.2);
                osc.connect(ctx.destination);
            }

            var pa;
            function bit(s, value, weight) {
                var b = value >= weight;
                value -= b ? weight : 0;
                pa += b ? 1 : 0;
                var duration = b ? 0.5 : 0.8;
                array.push(duration);
                var t = s + offset;
                if (t < 0) return value;
                var osc = ctx.createOscillator();
                osc.type = "square";
                osc.frequency.value = freq;
                osc.start(t);
                osc.stop(t + duration);
                osc.connect(ctx.destination);
                return value;
            }

            marker(0);
            pa = 0;
            minute = bit(1, minute, 40); minute = bit(2, minute, 20);
            minute = bit(3, minute, 10); minute = bit(4, minute, 16);
            minute = bit(5, minute, 8);  minute = bit(6, minute, 4);
            minute = bit(7, minute, 2);  minute = bit(8, minute, 1);
            var pa2 = pa;

            marker(9);
            pa = 0;
            hour = bit(10, hour, 80); hour = bit(11, hour, 40);
            hour = bit(12, hour, 20); hour = bit(13, hour, 10);
            hour = bit(14, hour, 16); hour = bit(15, hour, 8);
            hour = bit(16, hour, 4);  hour = bit(17, hour, 2);
            hour = bit(18, hour, 1);
            var pa1 = pa;

            marker(19);
            year_day = bit(20, year_day, 800); year_day = bit(21, year_day, 400);
            year_day = bit(22, year_day, 200); year_day = bit(23, year_day, 100);
            year_day = bit(24, year_day, 160); year_day = bit(25, year_day, 80);
            year_day = bit(26, year_day, 40);  year_day = bit(27, year_day, 20);
            year_day = bit(28, year_day, 10);

            marker(29);
            year_day = bit(30, year_day, 8); year_day = bit(31, year_day, 4);
            year_day = bit(32, year_day, 2); year_day = bit(33, year_day, 1);

            bit(34, 0, 1); bit(35, 0, 1);
            bit(36, pa1 % 2, 1); bit(37, pa2 % 2, 1);
            bit(38, 0, 1);

            marker(39);
            bit(40, summer_time ? 1 : 0, 1); // Applies the DST checkbox state here!

            year = bit(41, year, 80); year = bit(42, year, 40);
            year = bit(43, year, 20); year = bit(44, year, 10);
            year = bit(45, year, 8);  year = bit(46, year, 4);
            year = bit(47, year, 2);  year = bit(48, year, 1);

            marker(49);
            week_day = bit(50, week_day, 4);
            week_day = bit(51, week_day, 2);
            week_day = bit(52, week_day, 1);

            if (leapsecond === 0) { bit(53, 0, 1); bit(54, 0, 1); }
            else if (leapsecond > 0) { bit(53, 1, 1); bit(54, 1, 1); }
            else { bit(53, 1, 1); bit(54, 0, 1); }

            bit(55, 0, 1); bit(56, 0, 1);
            bit(57, 0, 1); bit(58, 0, 1);

            marker(59);
            return array;
        },

        formatDate: function(date, optStates) {
            var useLocalTime = optStates ? optStates[0] : false;
            var useDST = optStates ? optStates[1] : false;

            var year_utc = date.getUTCFullYear();
            var month_utc = date.getUTCMonth() + 1;
            var day_utc = date.getUTCDate();
            var hour_utc = date.getUTCHours();
            var minute_utc = date.getUTCMinutes();
            var second_utc = date.getUTCSeconds();

            var utcStr = `| UTC: ${year_utc}-${month_utc.toString().padStart(2, '0')}-${day_utc.toString().padStart(2, '0')} ` +
                         `${hour_utc.toString().padStart(2, '0')}:${minute_utc.toString().padStart(2, '0')}:${second_utc.toString().padStart(2, '0')}`;
            var dstStr = useDST ? "[DST ON]" : "[DST OFF]";

            if (useLocalTime) {
                var yearLoc = date.getFullYear();
                var monthLoc = date.getMonth() + 1;
                var dayLoc = date.getDate();
                var hourLoc = date.getHours();
                var minuteLoc = date.getMinutes();
                var secondLoc = date.getSeconds();

                return `Local Time ${dstStr}: ${yearLoc}-${monthLoc.toString().padStart(2, '0')}-${dayLoc.toString().padStart(2, '0')} ` +
                       `${hourLoc.toString().padStart(2, '0')}:${minuteLoc.toString().padStart(2, '0')}:${secondLoc.toString().padStart(2, '0')} ${utcStr}`;
            } else {
                var dateUTC = new Date(date.getTime() + date.getTimezoneOffset() * 60 * 1000);
                var dateJST = new Date(dateUTC.getTime() + 9 * 60 * 60 * 1000);

                var yearJST = dateJST.getFullYear();
                var monthJST = dateJST.getMonth() + 1;
                var dayJST = dateJST.getDate();
                var hourJST = dateJST.getHours();
                var minuteJST = dateJST.getMinutes();
                var secondJST = dateJST.getSeconds();

                return `JST (UTC+9) ${dstStr}: ${yearJST}-${monthJST.toString().padStart(2, '0')}-${dayJST.toString().padStart(2, '0')} ` +
                       `${hourJST.toString().padStart(2, '0')}:${minuteJST.toString().padStart(2, '0')}:${secondJST.toString().padStart(2, '0')} ${utcStr}`;
            }
        },

        drawBar: function(ctx2d, val, index, now, barX, barY, cellWidth, cellHeight) {
            if (val < 0.3) ctx2d.fillStyle = (index == now) ? "#FF0000" : "#7F0000";
            else if (val < 0.7) ctx2d.fillStyle = (index == now) ? "#FFFF00" : "#7F7F00";
            else ctx2d.fillStyle = (index == now) ? "#00FF00" : "#007F00";

            var barWidth = cellWidth * val;
            ctx2d.fillRect(barX, barY, barWidth, cellHeight);
        }
    };
})();
