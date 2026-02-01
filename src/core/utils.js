const util = require('util');
const fs = require('fs');
const path = require('path');
const async = require('async');

const fileExists = fs.exists || path.exists;
const fileExistsSync = fs.existsSync || path.existsSync;

function extend(obj, mixin) {
  for (const name of Object.keys(mixin)) {
    obj[name] = mixin[name];
  }
}

function stripExtension(filename) {
  return filename.replace(/(.+)\.[^.]+$/, '$1');
}

function readJSON(filename, callback) {
  async.waterfall([
    (callback) => fs.readFile(filename, callback),
    (buffer, callback) => {
      try {
        const rv = JSON.parse(buffer.toString());
        callback(null, rv);
      } catch (error) {
        error.filename = filename;
        error.message = `parsing ${path.basename(filename)}: ${error.message}`;
        callback(error);
      }
    }
  ], callback);
}

function readJSONSync(filename) {
  const buffer = fs.readFileSync(filename);
  return JSON.parse(buffer.toString());
}

function readdirRecursive(directory, callback) {
  const result = [];
  function walk(dir, callback) {
    async.waterfall([
      (callback) => async.apply(fs.readdir, path.join(directory, dir))(callback),
      (filenames, callback) => {
        async.forEach(filenames, (filename, callback) => {
          const relname = path.join(dir, filename);
          async.waterfall([
            (callback) => async.apply(fs.stat, path.join(directory, relname))(callback),
            (stat, callback) => {
              if (stat.isDirectory()) {
                walk(relname, callback);
              } else {
                result.push(relname);
                callback();
              }
            }
          ], callback);
        }, callback);
      }
    ], callback);
  }
  walk('', (error) => callback(error, result));
}

function pump(source, destination, callback) {
  source.pipe(destination);
  source.on('error', (error) => {
    if (callback) callback(error);
    callback = null;
  });
  destination.on('finish', () => {
    if (callback) callback();
    callback = null;
  });
}

function rfc822(date) {
  const pad = (i) => (i < 10 ? '0' + i : i);
  const tzoffset = (offset) => {
    const hours = Math.floor(offset / 60);
    const minutes = Math.abs(offset % 60);
    const direction = hours > 0 ? '-' : '+';
    return direction + pad(Math.abs(hours)) + pad(minutes);
  };
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', ' Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
  return [
    days[date.getDay()] + ',',
    pad(date.getDate()),
    months[date.getMonth()],
    date.getFullYear(),
    time,
    tzoffset(date.getTimezoneOffset())
  ].join(' ');
}

module.exports = {
  fileExists,
  fileExistsSync,
  extend,
  stripExtension,
  readJSON,
  readJSONSync,
  readdirRecursive,
  pump,
  rfc822
};
