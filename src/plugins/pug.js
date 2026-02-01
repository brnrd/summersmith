const async = require('async');
const fs = require('fs');
const pug = require('pug');
const path = require('path');

module.exports = function (env, callback) {
  class PugTemplate extends env.TemplatePlugin {
    constructor(fn) {
      super();
      this.fn = fn;
    }

    render(locals, callback) {
      try {
        callback(null, Buffer.from(this.fn(locals)));
      } catch (error) {
        callback(error);
      }
    }

    static fromFile(filepath, callback) {
      async.waterfall([
        (callback) => fs.readFile(filepath.full, callback),
        (buffer, callback) => {
          const conf = env.config.pug || {};
          conf.filename = filepath.full;
          try {
            const rv = pug.compile(buffer.toString(), conf);
            callback(null, new this(rv));
          } catch (error) {
            callback(error);
          }
        }
      ], callback);
    }
  }

  env.registerTemplatePlugin('**/*.*(pug|jade)', PugTemplate);
  callback();
};
