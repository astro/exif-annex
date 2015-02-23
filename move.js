#!/usr/bin/env node
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

function findTags(a) {
    var result = [];
    function push(x) {
        result.push(x);
    }

    if (typeof a === 'object' && a.tags) {
        // Found
        push(a.tags);
    } else if (typeof a === 'object') {
        // Recurse
        Object.keys(a).forEach(function(k) {
            findTags(a[k]).forEach(push);
        });
    } else if (a && a.forEach) {
        // Recurse
        a.forEach(function(k) {
            findTags(k).forEach(push);
        });
    }

    return result;
}

if (process.argv.length != 4) {
    console.log("Usage: " + process.argv[0] + " " + process.argv[1] + " <source-dir> <target-base-dir>");
    process.exit(1);
}

var pendingPaths = [process.argv[2]];
var targetDir = process.argv[3];
var running = 0;
var cpus = 2 * os.cpus().length;

function go() {
    running++;
    var path = pendingPaths.shift();
    if (!path) {
        running--;
        if (running < 1) {
            // All done!
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
            child_process.execFile("/usr/bin/env", ["ffprobe", "-loglevel", "quiet", "-print_format", "json", "-show_frames", path], function (err, stdout, stderr) {
                if (stderr) {
                    console.error(stderr.toString());
                }
                if (err) {
                    console.error(path + ": " + err.message);
                    return go();
                }

                try {
                    var date;
                    var json = JSON.parse(stdout);
                    var tagsList = findTags(json);
                    tagsList.forEach(function(tags) {
                        var m;
                        if (tags.DateTime &&
                            (m = tags.DateTime.match(/^(\d+):(\d+):(\d+) (\d+):(\d+):(\d+)/))) {

                            date = [m[1], m[2], m[3]];
                        }
                    });
                    if (date) {
                        var target = [targetDir].concat(date, "").join("/");
                        child_process.execFile("/usr/bin/env", ["mkdir", "-p", target], function() {
                            console.log("mv " + path + " " + target);
                            child_process.execFile("/usr/bin/env", ["mv", path, target], go);
                        });
                    } else {
                        console.log("No date for " + path);
                        go();
                    }
                } catch (e) {
                    console.error(path + "\n" + (e.stack || e.message));
                    go();
                }
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
