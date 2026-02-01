const async = require('async');
const fs = require('fs');
const minimatch = require('minimatch');
const path = require('path');
const { extend, readdirRecursive } = require('./utils');

class TemplatePlugin {
  render(locals, callback) {
    throw new Error('Not implemented.');
  }

  static fromFile(filepath, callback) {
    throw new Error('Not implemented.');
  }
}

function loadTemplates(env, callback) {
  const templates = {};

  const resolveFilenames = (filenames, callback) => {
    async.map(filenames, (filename, callback) => {
      callback(null, {
        full: path.join(env.templatesPath, filename),
        relative: filename
      });
    }, callback);
  };

  const loadTemplate = (filepath, callback) => {
    let plugin = null;
    for (let i = env.templatePlugins.length - 1; i >= 0; i--) {
      if (minimatch(filepath.relative, env.templatePlugins[i].pattern)) {
        plugin = env.templatePlugins[i];
        break;
      }
    }
    if (plugin != null) {
      plugin.class.fromFile(filepath, (error, template) => {
        if (error) error.message = `template ${filepath.relative}: ${error.message}`;
        templates[filepath.relative] = template;
        callback(error);
      });
    } else {
      callback();
    }
  };

  async.waterfall([
    (callback) => readdirRecursive(env.templatesPath, callback),
    resolveFilenames,
    (filenames, callback) => async.forEach(filenames, loadTemplate, callback)
  ], (error) => callback(error, templates));
}

module.exports = { TemplatePlugin, loadTemplates };
