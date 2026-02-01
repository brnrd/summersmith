const async = require('async');
const fs = require('fs');
const path = require('path');
const url = require('url');
const chalk = require('chalk');
const minimatch = require('minimatch');

const minimatchOptions = { dot: false };

if (typeof setImmediate === 'undefined') {
  global.setImmediate = process.nextTick;
}

class ContentPlugin {
  static property(name, getter) {
    const get = typeof getter === 'string'
      ? function () { return this[getter].call(this); }
      : function () { return getter.call(this); };
    Object.defineProperty(this.prototype, name, {
      get,
      enumerable: true
    });
  }

  getView() {
    throw new Error('Not implemented.');
  }

  getFilename() {
    throw new Error('Not implemented.');
  }

  getUrl(base) {
    const filename = this.getFilename();
    base = base != null ? base : this.__env.config.baseUrl;
    if (!base.match(/\/$/)) base += '/';
    if (process.platform === 'win32') {
      filename = filename.replace(/\\/g, '/');
    }
    return url.resolve(base, filename);
  }

  getPluginColor() {
    return 'cyan';
  }

  getPluginInfo() {
    return `url: ${this.url}`;
  }

  static fromFile(filepath, callback) {
    throw new Error('Not implemented.');
  }
}

ContentPlugin.property('view', 'getView');
ContentPlugin.property('filename', 'getFilename');
ContentPlugin.property('url', 'getUrl');
ContentPlugin.property('pluginColor', 'getPluginColor');
ContentPlugin.property('pluginInfo', 'getPluginInfo');

class StaticFile extends ContentPlugin {
  constructor(filepath) {
    super();
    this.filepath = filepath;
  }

  getView() {
    return (...args) => {
      const callback = args[args.length - 1];
      try {
        const rs = fs.createReadStream(this.filepath.full);
        callback(null, rs);
      } catch (error) {
        callback(error);
      }
    };
  }

  getFilename() {
    return this.filepath.relative;
  }

  getPluginColor() {
    return 'none';
  }

  static fromFile(filepath, callback) {
    callback(null, new StaticFile(filepath));
  }
}

function loadContent(env, filepath, callback) {
  env.logger.silly(`loading ${filepath.relative}`);

  let plugin = {
    class: StaticFile,
    group: 'files'
  };

  for (let i = env.contentPlugins.length - 1; i >= 0; i--) {
    if (minimatch(filepath.relative, env.contentPlugins[i].pattern, minimatchOptions)) {
      plugin = env.contentPlugins[i];
      break;
    }
  }

  plugin.class.fromFile(filepath, (error, instance) => {
    if (error) error.message = `${filepath.relative}: ${error.message}`;
    if (instance != null) instance.__env = env;
    if (instance != null) instance.__plugin = plugin;
    if (instance != null) instance.__filename = filepath.full;
    callback(error, instance);
  });
}

function ContentTree(filename, groupNames = []) {
  let parent = null;
  const groups = { directories: [], files: [] };
  for (const name of groupNames) {
    groups[name] = [];
  }
  Object.defineProperty(this, '__groupNames', {
    get: () => groupNames
  });
  Object.defineProperty(this, '_', {
    get: () => groups
  });
  Object.defineProperty(this, 'filename', {
    get: () => filename
  });
  Object.defineProperty(this, 'index', {
    get: () => {
      for (const key of Object.keys(this)) {
        if (key.slice(0, 6) === 'index.') {
          return this[key];
        }
      }
      return undefined;
    }
  });
  Object.defineProperty(this, 'parent', {
    get: () => parent,
    set: (val) => { parent = val; }
  });
}

ContentTree.fromDirectory = function (env, directory, callback) {
  const reldir = env.relativeContentsPath(directory);
  const tree = new ContentTree(reldir, env.getContentGroups());

  env.logger.silly(`creating content tree from ${directory}`);

  const readDirectory = (callback) => fs.readdir(directory, callback);

  const resolveFilenames = (filenames, callback) => {
    filenames.sort();
    async.map(filenames, (filename, callback) => {
      const relname = path.join(reldir, filename);
      callback(null, {
        full: path.join(env.contentsPath, relname),
        relative: relname
      });
    }, callback);
  };

  const filterIgnored = (filenames, callback) => {
    if (env.config.ignore.length > 0) {
      async.filter(filenames, (filename, callback) => {
        let include = true;
        for (const pattern of env.config.ignore) {
          if (minimatch(filename.relative, pattern, minimatchOptions)) {
            env.logger.verbose(`ignoring ${filename.relative} (matches: ${pattern})`);
            include = false;
            break;
          }
        }
        callback(null, include);
      }, callback);
    } else {
      callback(null, filenames);
    }
  };

  const createInstance = (filepath, callback) => {
    setImmediate(() => {
      async.waterfall([
        (callback) => async.apply(fs.stat, filepath.full)(callback),
        (stats, callback) => {
          const basename = path.basename(filepath.relative);
          if (stats.isDirectory()) {
            ContentTree.fromDirectory(env, filepath.full, (error, result) => {
              result.parent = tree;
              tree[basename] = result;
              tree._.directories.push(result);
              callback(error);
            });
          } else if (stats.isFile()) {
            loadContent(env, filepath, (error, instance) => {
              if (!error) {
                instance.parent = tree;
                tree[basename] = instance;
                tree._[instance.__plugin.group].push(instance);
              }
              callback(error);
            });
          } else {
            callback(new Error(`Invalid file ${filepath.full}.`));
          }
        }
      ], callback);
    });
  };

  const createInstances = (filenames, callback) => {
    async.forEachLimit(filenames, env.config._fileLimit, createInstance, callback);
  };

  async.waterfall([
    readDirectory,
    resolveFilenames,
    filterIgnored,
    createInstances
  ], (error) => callback(error, tree));
};

ContentTree.inspect = function (tree, depth = 0) {
  if (typeof tree === 'number') {
    return '[Function: ContentTree]';
  }
  const rv = [];
  let pad = '';
  for (let i = 0; i <= depth; i++) pad += '  ';
  const keys = Object.keys(tree).sort((a, b) => {
    const ad = tree[a] instanceof ContentTree;
    const bd = tree[b] instanceof ContentTree;
    if (ad !== bd) return bd - ad;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  for (const k of keys) {
    const v = tree[k];
    let s;
    if (v instanceof ContentTree) {
      s = chalk.bold(k) + '/\n';
      s += ContentTree.inspect(v, depth + 1);
    } else {
      let cfn = (s) => s;
      if (v.pluginColor !== 'none') {
        if (!chalk[v.pluginColor]) {
          throw new Error(`Plugin ${k} specifies invalid pluginColor: ${v.pluginColor}`);
        }
        cfn = chalk[v.pluginColor];
      }
      s = cfn(k) + ' (' + chalk.grey(v.pluginInfo) + ')';
    }
    rv.push(pad + s);
  }
  return rv.join('\n');
};

ContentTree.flatten = function (tree) {
  const rv = [];
  for (const key of Object.keys(tree)) {
    const value = tree[key];
    if (value instanceof ContentTree) {
      rv.push(...ContentTree.flatten(value));
    } else {
      rv.push(value);
    }
  }
  return rv;
};

ContentTree.merge = function (root, tree) {
  for (const key of Object.keys(tree)) {
    const item = tree[key];
    if (item instanceof ContentPlugin) {
      root[key] = item;
      item.parent = root;
      root._[item.__plugin.group].push(item);
    } else if (item instanceof ContentTree) {
      if (root[key] == null) {
        root[key] = new ContentTree(key, item.__groupNames);
        root[key].parent = root;
        root[key].parent._.directories.push(root[key]);
      }
      if (root[key] instanceof ContentTree) {
        ContentTree.merge(root[key], item);
      }
    } else {
      throw new Error(`Invalid item in tree for '${key}'`);
    }
  }
};

module.exports = { ContentTree, ContentPlugin, StaticFile, loadContent };
