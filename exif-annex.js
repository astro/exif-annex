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

function setMetadata(path, metadata, cb) {
    var settings = [];
    if (metadata) {
        Object.keys(metadata).forEach(function(key) {
            settings.push("-s", key + "=" + metadata[key]);
        });
    }

    if (settings.length > 0) {
        child_process.execFile("/usr/bin/env", ["git-annex", "metadata", path].concat(settings),function (err, stdout, stderr) {
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
var cpus = 2 * os.cpus().length;

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

                var metadata = {};
                try {
                    var json = JSON.parse(stdout);
                    (json.packets_and_frames || []).forEach(function(json1) {
                        var tags;
                        var m;
                        if ((tags = json1.tags)) {
                            if (tags.DateTime &&
                                (m = tags.DateTime.match(/^(\d+):(\d+):(\d+) (\d+):(\d+):(\d+)/))) {

                                metadata.year = m[1];
                                metadata.month = m[2];
                                metadata.day = m[3];
                                metadata.date = m[1] + "-" + m[2] + "-" + m[3];
                            }
                            if (tags.Model) {
                                metadata.model = tags.Model;
                            }
                            if (tags['0xA434']) {
                                metadata.objective = tags['0xA434'];
                            }
                            if (tags.ISOSpeedRatings) {
                                metadata.iso = Number(tags.ISOSpeedRatings);
                            }
                            if (tags.ExposureTime &&
                                (m = tags.ExposureTime.match(/(\d+):(\d+)/))) {
                                metadata.exposure = Number(m[1]) / Number(m[2]);
                            }
                            if (tags.FNumber &&
                                (m = tags.FNumber.match(/(\d+):(\d+)/))) {
                                metadata.f = Number(m[1]) / Number(m[2]);
                            }
                            if (tags.ApertureValue &&
                                (m = tags.ApertureValue.match(/(\d+):(\d+)/))) {
                                metadata.aperture = Number(m[1]) / Number(m[2]);
                            }
                            if (tags.ShutterSpeedValue &&
                                (m = tags.ShutterSpeedValue.match(/(\d+):(\d+)/))) {
                                metadata.shutter = Number(m[1]) / Number(m[2]);
                            }
                        }
                    });
                    console.log(path, metadata);
                } catch (e) {
                    console.error(e.stack || e.message);
                }

                setMetadata(path, metadata, go);
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
