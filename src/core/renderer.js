const fs = require('fs');
const util = require('util');
const async = require('async');
const path = require('path');
const { Stream } = require('stream');
const { ContentTree } = require('./content');
const { pump, extend } = require('./utils');

if (typeof setImmediate === 'undefined') {
  global.setImmediate = process.nextTick;
}

function renderView(env, content, locals, contents, templates, callback) {
  setImmediate(() => {
    const _locals = { env, contents };
    extend(_locals, locals);

    let view = content.view;
    if (typeof view === 'string') {
      const name = view;
      view = env.views[name];
      if (view == null) {
        callback(new Error(`content '${content.filename}' specifies unknown view '${name}'`));
        return;
      }
    }

    view.call(content, env, _locals, contents, templates, (error, result) => {
      if (error) error.message = `${content.filename}: ${error.message}`;
      callback(error, result);
    });
  });
}

function render(env, outputDir, contents, templates, locals, callback) {
  env.logger.info(`rendering tree:\n${ContentTree.inspect(contents, 1)}\n`);
  env.logger.verbose(`render output directory: ${outputDir}`);

  const renderPlugin = (content, callback) => {
    renderView(env, content, locals, contents, templates, (error, result) => {
      if (error) {
        callback(error);
      } else if (result instanceof Stream || result instanceof Buffer) {
        const destination = path.join(outputDir, content.filename);
        env.logger.verbose(`writing content ${content.url} to ${destination}`);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const writeStream = fs.createWriteStream(destination);
        if (result instanceof Stream) {
          pump(result, writeStream, callback);
        } else {
          writeStream.end(result, callback);
        }
      } else {
        env.logger.verbose(`skipping ${content.url}`);
        callback();
      }
    });
  };

  const items = ContentTree.flatten(contents);
  async.forEachLimit(items, env.config._fileLimit, renderPlugin, callback);
}

module.exports = { render, renderView };
