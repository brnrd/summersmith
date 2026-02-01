const async = require('async');
const chokidar = require('chokidar');
const chalk = require('chalk');
const http = require('http');
const mime = require('mime');
const url = require('url');
const minimatch = require('minimatch');
const enableDestroy = require('server-destroy');
const { Stream } = require('stream');

const { Config } = require('./config');
const { ContentTree, ContentPlugin, loadContent } = require('./content');
const { pump } = require('./utils');
const { renderView } = require('./renderer');
const { runGenerator } = require('./generator');

function colorCode(code) {
  switch (Math.floor(code / 100)) {
    case 2: return chalk.green(code);
    case 4: return chalk.yellow(code);
    case 5: return chalk.red(code);
    default: return code.toString();
  }
}

function sleep(callback) {
  setTimeout(callback, 50);
}

function normalizeUrl(anUrl) {
  if (anUrl[anUrl.length - 1] === '/') anUrl += 'index.html';
  if (anUrl.match(/^([^.]*[^/])$/)) anUrl += '/index.html';
  anUrl = decodeURI(anUrl);
  return anUrl;
}

function urlEqual(urlA, urlB) {
  return normalizeUrl(urlA) === normalizeUrl(urlB);
}

function keyForValue(object, value) {
  for (const key of Object.keys(object)) {
    if (object[key] === value) return key;
  }
  return null;
}

function replaceInArray(array, oldItem, newItem) {
  const idx = array.indexOf(oldItem);
  if (idx === -1) return false;
  array[idx] = newItem;
  return true;
}

function buildLookupMap(contents) {
  const map = {};
  for (const item of ContentTree.flatten(contents)) {
    map[normalizeUrl(item.url)] = item;
  }
  return map;
}

function lookupCharset(mimeType) {
  return (/^text\/|^application\/(javascript|json)/.test(mimeType)) ? 'UTF-8' : null;
}

function setup(env) {
  let contents = null;
  let templates = null;
  let locals = null;
  let lookup = {};

  const block = {
    contentsLoad: false,
    templatesLoad: false,
    viewsLoad: false,
    localsLoad: false
  };

  const isReady = () => {
    for (const k of Object.keys(block)) {
      if (block[k] === true) return false;
    }
    return true;
  };

  const logop = (error) => {
    if (error != null) env.logger.error(error.message, error);
  };

  const changeHandler = (error, path) => {
    if (error == null) env.emit('change', path, false);
    logop(error);
  };

  const loadContents = (callback = logop) => {
    block.contentsLoad = true;
    lookup = {};
    contents = null;
    ContentTree.fromDirectory(env, env.contentsPath, (error, result) => {
      if (error == null) {
        contents = result;
        lookup = buildLookupMap(result);
      }
      block.contentsLoad = false;
      callback(error);
    });
  };

  const loadTemplates = (callback = logop) => {
    block.templatesLoad = true;
    templates = null;
    env.getTemplates((error, result) => {
      if (error == null) templates = result;
      block.templatesLoad = false;
      callback(error);
    });
  };

  const loadViews = (callback = logop) => {
    block.viewsLoad = true;
    env.loadViews((error) => {
      block.viewsLoad = false;
      callback(error);
    });
  };

  const loadLocals = (callback = logop) => {
    block.localsLoad = true;
    locals = null;
    env.getLocals((error, result) => {
      if (error == null) locals = result;
      block.localsLoad = false;
      callback(error);
    });
  };

  const contentWatcher = chokidar.watch(env.contentsPath, { ignoreInitial: true });
  contentWatcher.on('all', (type, filename) => {
    if (block.contentsLoad) return;
    const relpath = env.relativeContentsPath(filename);
    for (const pattern of env.config.ignore) {
      if (minimatch(relpath, pattern)) {
        env.emit('change', relpath, true);
        return;
      }
    }
    loadContents((error) => {
      let contentFilename = null;
      if (error == null && filename != null && contents != null) {
        for (const content of ContentTree.flatten(contents)) {
          if (content.__filename === filename) {
            contentFilename = content.filename;
            break;
          }
        }
      }
      changeHandler(error, contentFilename);
    });
  });

  const templateWatcher = chokidar.watch(env.templatesPath, { ignoreInitial: true });
  templateWatcher.on('all', (event, path) => {
    if (!block.templatesLoad) loadTemplates(changeHandler);
  });

  let viewsWatcher;
  if (env.config.views != null) {
    viewsWatcher = chokidar.watch(env.resolvePath(env.config.views), { ignoreInitial: true });
    viewsWatcher.on('all', (event, path) => {
      if (!block.viewsLoad) {
        delete require.cache[path];
        loadViews(changeHandler);
      }
    });
  }

  const contentHandler = (request, response, callback) => {
    const uri = normalizeUrl(url.parse(request.url).pathname);
    env.logger.verbose(`contentHandler - ${uri}`);

    async.waterfall([
      (callback) => {
        async.mapSeries(env.generators, (generator, callback) => {
          runGenerator(env, contents, generator, callback);
        }, callback);
      },
      (generated, callback) => {
        if (generated.length > 0) {
          try {
            const tree = new ContentTree('', env.getContentGroups());
            const genContents = new ContentTree('', env.getContentGroups());
            for (const gentree of generated) {
              ContentTree.merge(tree, gentree);
              ContentTree.merge(genContents, gentree);
            }
            const map = buildLookupMap(genContents);
            ContentTree.merge(tree, contents);
            callback(null, tree, map);
          } catch (error) {
            callback(error);
          }
        } else {
          callback(null, contents, {});
        }
      },
      (tree, generatorLookup, callback) => {
        const content = generatorLookup[uri] || lookup[uri];
        if (content != null) {
          const pluginName = content.constructor.name;
          renderView(env, content, locals, tree, templates, (error, result) => {
            if (error) return callback(error, 500, pluginName);
            if (result != null) {
              const mimeType = mime.getType(content.filename) || mime.getType(uri);
              const charset = lookupCharset(mimeType);
              const contentType = charset ? `${mimeType}; charset=${charset}` : mimeType;
              if (result instanceof Stream) {
                response.writeHead(200, { 'Content-Type': contentType });
                pump(result, response, (error) => callback(error, 200, pluginName));
              } else if (result instanceof Buffer) {
                response.writeHead(200, { 'Content-Type': contentType });
                response.write(result);
                response.end();
                callback(null, 200, pluginName);
              } else {
                callback(new Error(`View for content '${content.filename}' returned invalid response. Expected Buffer or Stream.`));
              }
            } else {
              response.writeHead(404, { 'Content-Type': 'text/plain' });
              response.end('404 Not Found\n');
              callback(null, 404, pluginName);
            }
          });
        } else {
          callback();
        }
      }
    ], callback);
  };

  const requestHandler = (request, response) => {
    const start = Date.now();
    const uri = url.parse(request.url).pathname;

    async.waterfall([
      (callback) => {
        if (!block.contentsLoad && contents == null) {
          loadContents(callback);
        } else {
          callback();
        }
      },
      (callback) => {
        if (!block.templatesLoad && templates == null) {
          loadTemplates(callback);
        } else {
          callback();
        }
      },
      (callback) => async.until(isReady, sleep, callback),
      (callback) => contentHandler(request, response, callback)
    ], (error, responseCode, pluginName) => {
      if (error != null || responseCode == null) {
        responseCode = error != null ? 500 : 404;
        response.writeHead(responseCode, { 'Content-Type': 'text/plain' });
        response.end(error != null ? error.message : '404 Not Found\n');
      }
      const delta = Date.now() - start;
      let logstr = `${colorCode(responseCode)} ${chalk.bold(uri)}`;
      if (pluginName != null) logstr += ` ${chalk.grey(pluginName)}`;
      logstr += chalk.grey(` ${delta}ms`);
      env.logger.info(logstr);
      if (error) env.logger.error(error.message, error);
    });
  };

  loadContents();
  loadTemplates();
  loadViews();
  loadLocals();

  requestHandler.destroy = () => {
    contentWatcher.close();
    templateWatcher.close();
    if (viewsWatcher != null) viewsWatcher.close();
  };

  return requestHandler;
}

function run(env, callback) {
  let server = null;
  let handler = null;

  if (env.config._restartOnConfChange && env.config.__filename != null) {
    env.logger.verbose(`watching config file ${env.config.__filename} for changes`);
    const configWatcher = chokidar.watch(env.config.__filename);
    configWatcher.on('change', () => {
      let config;
      try {
        config = Config.fromFileSync(env.config.__filename);
      } catch (error) {
        env.logger.error(`Error reloading config: ${error.message}`, error);
      }
      if (config != null) {
        if (env.config._cliopts != null) {
          config._cliopts = {};
          for (const key of Object.keys(env.config._cliopts)) {
            config[key] = config._cliopts[key] = env.config._cliopts[key];
          }
        }
        env.setConfig(config);
        restart((error) => {
          if (error) throw error;
          env.logger.verbose('config file change detected, server reloaded');
          env.emit('change');
        });
      }
    });
  }

  const restart = (callback) => {
    env.logger.info('restarting server');
    async.waterfall([stop, start], callback);
  };

  const stop = (callback) => {
    if (server != null) {
      server.destroy((error) => {
        handler.destroy();
        env.reset();
        callback(error);
      });
    } else {
      callback();
    }
  };

  const start = (callback) => {
    async.series([
      (callback) => env.loadPlugins(callback),
      (callback) => {
        handler = setup(env);
        server = http.createServer(handler);
        enableDestroy(server);
        server.on('error', (error) => {
          if (callback) callback(error);
          callback = null;
        });
        server.on('listening', () => {
          if (callback) callback(null, server);
          callback = null;
        });
        server.listen(env.config.port, env.config.hostname);
      }
    ], callback);
  };

  process.on('uncaughtException', (error) => {
    env.logger.error(error.message, error);
    process.exit(1);
  });

  env.logger.verbose('starting preview server');

  start((error, server) => {
    if (error == null) {
      const host = env.config.hostname || 'localhost';
      const serverUrl = `http://${host}:${env.config.port}${env.config.baseUrl}`;
      env.logger.info(`server running on: ${chalk.bold(serverUrl)}`);
    }
    callback(error, server);
  });
}

module.exports = { run, setup };
