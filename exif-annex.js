var fs = require('fs');
var os = require('os');
var child_process = require('child_process');

function pad(s) {
    s = s.toString();
    while(s.length < 2) {
        s = "0" + s;
    }
    return s;
}

function setMetadata(path, date, cb) {
    if (date) {
        var settings = [
            path,
            "-s", "year=" + date.getFullYear(),
            "-s", "month=" + pad(date.getMonth() + 1),
            "-s", "day=" + pad(date.getDate()),
            "-s", "date=" + date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate())
        ];
        child_process.execFile("/usr/bin/env", ["git-annex", "metadata"].concat(settings),function (err, stdout, stderr) {
            if (stderr) {
                console.error(stderr.toString());
            }
            if (err) {
                console.error(err.message);
            }
            
            cb(err);
        });
    } else {
        cb();
    }
}

var pendingPaths = ["."];
var running = 0;
var cpus = 4 * os.cpus().length;

function go() {
    running++;
    var path = pendingPaths.shift();
    if (!path) {
        running--;
        if (running < 1) {
            flushMetadata();
        }
        return;
    }

    fs.stat(path, function (err, stats) {
        if (err) {
            console.error(path + ": " + err.message);
            return go();
        }

        if (stats.isDirectory()) {
            fs.readdir(path, function (err, files) {
                if (err) {
                    console.error(path + ": " + err.message);
                    return go();
                }

                files.forEach(function(file) {
                    if (!/^\./.test(file)) {
                        pendingPaths.push(path + "/" + file);
                    }
                });
                return go();
            });
        } else if (/\.jpe?g$/i.test(path)) {
            child_process.execFile("/usr/bin/env", ["ffprobe", "-loglevel", "quiet", "-print_format", "json", "-show_frames", "-show_streams", "-show_format", "-show_packets", path], function (err, stdout, stderr) {
                if (stderr) {
                    console.error(stderr.toString());
                }
                if (err) {
                    console.error(path + ": " + err.message);
                    return go();
                }

                var date;
                try {
                    var json = JSON.parse(stdout);
                    (json.packets_and_frames || []).forEach(function(json1) {
                        var m;
                        if (json1.tags && json1.tags.DateTime &&
                            (m = json1.tags.DateTime.match(/^(\d+):(\d+):(\d+) (\d+):(\d+):(\d+)/))) {

                            date = new Date(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
                        }
                    });
                    console.log(path, date);
                } catch (e) {
                    console.error(e.stack || e.message);
                }

                setMetadata(path, date, go);
            });
        } else {
            go();
        }
    });

    while (running < cpus && pendingPaths.length > 0) {
        go();
    }
}

go();
