#!/usr/bin/env node
var fs = require('fs');
var os = require('os');
var child_process = require('child_process');

process.on('uncaughtException', function(e) {
    console.error(e.stack)
});

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

function ffprobe(what, path, cb) {
    child_process.execFile("/usr/bin/env", ["ffprobe", "-loglevel", "quiet", "-print_format", "json", what, path], {
        maxBuffer: 2 * 1024 * 1024
    }, function (err, stdout, stderr) {
        if (stderr) {
            console.error(stderr.toString());
        }
        if (err) {
            console.error(path + ": " + err.message);
        }
        var json = JSON.parse(stdout);
        cb(err, json);
    });
}

function exiv2(path, cb) {
    console.log("exiv2", path);
    child_process.execFile("/usr/bin/env", ["exiv2", path], {
        maxBuffer: 2 * 1024 * 1024
    }, function (err, stdout, stderr) {
        var result;
        if (stderr) {
            console.error(stderr.toString());
        }
        if (!err) {
            try {
                var m = stdout.match(/Image timestamp\s*: (\d+):(\d+):(\d+) (\d+):(\d+):(\d+)/);
                result = {
                    date: [m[1], m[2], m[3]],
                    time: [m[4], m[5], m[6]]
                };
            } catch(e) {
                err = e;
            }
        }
        if (err) {
            console.error(path + ": " + err.message);
        }
        cb(err, result);
    });
}

function cp(path, target, cb) {
    child_process.execFile("/usr/bin/env", ["mkdir", "-p", target], function() {
        console.log("cp " + path + " " + target);
        child_process.execFile("/usr/bin/env", ["cp", "-u", path, target], function (err, stdout, stderr) {
            if (stderr) {
                console.error(stderr.toString());
            }
            if (err) {
                console.error(path + ": " + err.message);
            }
            cb(err);
        });
    });
}

if (process.argv.length != 4) {
    console.log("Usage: " + process.argv[0] + " " + process.argv[1] + " <source-dir> <target-base-dir>");
    process.exit(1);
}

var pendingPaths = [process.argv[2]];
var targetDir = process.argv[3];
var running = 0;
var cpus = os.cpus().length;

function go() {
    running++;
    var path = pendingPaths.shift();
    if (!path) {
        running--;
        if (running < 1) {
            // All done!
            console.log("All done");
        }
        return;
    }
    function next(err) {
        if (err) {
            console.error(path + ": " + err.message);
        }
        running--;
        go();
    }

    fs.stat(path, function (err, stats) {
        if (err) {
            console.error(path + ": " + err.message);
            return next();
        }

        if (stats.isDirectory()) {
            fs.readdir(path, function (err, files) {
                if (err) {
                    console.error(path + ": " + err.message);
                    return next();
                }

                files.sort(function(a, b) {
                    if (a > b)
                        return -1;
                    else if (a < b)
                        return 1;
                    else
                        return 0;
                }).forEach(function(file) {
                    if (!/^\./.test(file)) {
                        pendingPaths.push(path + "/" + file);
                    }
                });
                return next();
            });
        } else if (/\.jpe?g$/i.test(path) || /\.nef$/i.test(path)) {
            exiv2(path, function (err, info) {
                if (err) {
                    return next();
                }

                if (info.date) {
                    var target = [targetDir].concat(info.date, "").join("/");
                    cp(path, target, next);
                } else {
                    console.log("No date for " + path);
                    next();
                }
            });
        } else if (/\.mp4$/i.test(path) || /\.mov$/i.test(path) || /\.m4v$/i.test(path)) {
            ffprobe("-show_format", path, function (err, json) {
                if (err) {
                    return next();
                }

                var date;
                var tagsList = findTags(json);
                tagsList.forEach(function(tags) {
                    var d;
                    var m;
                    if ((d = tags.creation_time) &&
                        (m = d.match(/^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)/))) {

                        date = [m[1], m[2], m[3]];
                    }
                });
                if (date) {
                    var target = [targetDir].concat(date, "").join("/");
                    cp(path, target, next);
                } else {
                    console.log("No date for " + path);
                    next();
                }
            });
        } else {
            next();
        }
    });

    while (running < cpus && pendingPaths.length > 0) {
        go();
    }
}

go();
