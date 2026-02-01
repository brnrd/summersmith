const fs = require('fs');
const path = require('path');
const async = require('async');
const { readJSON, readJSONSync, fileExists, fileExistsSync } = require('./utils');

class Config {
  static defaults = {
    contents: './contents',
    ignore: [],
    locals: {},
    plugins: [],
    require: {},
    templates: './templates',
    views: null,
    output: './build',
    baseUrl: '/',
    hostname: null,
    port: 8080,
    _fileLimit: 40,
    _restartOnConfChange: true
  };

  constructor(options = {}) {
    for (const option of Object.keys(options)) {
      this[option] = options[option];
    }
    for (const option of Object.keys(Config.defaults)) {
      if (this[option] == null) {
        this[option] = Config.defaults[option];
      }
    }
  }

  static fromFile(path, callback) {
    async.waterfall([
      (callback) => {
        fileExists(path, (exists) => {
          if (exists) {
            readJSON(path, callback);
          } else {
            callback(new Error(`Config file at '${path}' does not exist.`));
          }
        });
      },
      (options, callback) => {
        const config = new Config(options);
        config.__filename = path;
        callback(null, config);
      }
    ], callback);
  }

  static fromFileSync(path) {
    if (!fileExistsSync(path)) {
      throw new Error(`Config file at '${path}' does not exist.`);
    }
    const config = new Config(readJSONSync(path));
    config.__filename = path;
    return config;
  }
}

module.exports = { Config };
