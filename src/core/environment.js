const path = require('path');
const async = require('async');
const fs = require('fs');
const { EventEmitter } = require('events');

const utils = require('./utils');
const { Config } = require('./config');
const { ContentPlugin, ContentTree, StaticFile } = require('./content');
const { TemplatePlugin, loadTemplates } = require('./templates');
const { logger } = require('./logger');
const { render } = require('./renderer');
const { runGenerator } = require('./generator');

const { readJSON, readJSONSync } = utils;

class Environment extends EventEmitter {
  constructor(config, workDir, logger) {
    super();
    this.workDir = path.resolve(workDir);
    this.logger = logger;
    this.utils = utils;
    this.ContentTree = ContentTree;
    this.ContentPlugin = ContentPlugin;
    this.TemplatePlugin = TemplatePlugin;
    this.loadedModules = [];
    this.setConfig(config);
    this.reset();
  }

  reset() {
    this.views = { none: (...args) => { const cb = args[args.length - 1]; if (typeof cb === 'function') cb(); } };
    this.generators = [];
    this.plugins = { StaticFile };
    this.templatePlugins = [];
    this.contentPlugins = [];
    this.helpers = {};

    while (this.loadedModules.length > 0) {
      const id = this.loadedModules.pop();
      this.logger.verbose(`unloading: ${id}`);
      delete require.cache[id];
    }

    this.setupLocals();
  }

  setConfig(config) {
    this.config = config;
    this.contentsPath = this.resolvePath(this.config.contents);
    this.templatesPath = this.resolvePath(this.config.templates);
  }

  setupLocals() {
    this.locals = {};

    if (typeof this.config.locals === 'string') {
      const filename = this.resolvePath(this.config.locals);
      this.logger.verbose(`loading locals from: ${filename}`);
      this.locals = readJSONSync(filename);
    } else {
      this.locals = this.config.locals;
    }

    for (const alias of Object.keys(this.config.require)) {
      const id = this.config.require[alias];
      logger.verbose(`loading module '${id}' available in locals as '${alias}'`);
      if (this.locals[alias] != null) {
        logger.warn(`module '${id}' overwrites previous local with the same key ('${alias}')`);
      }
      try {
        this.locals[alias] = this.loadModule(id);
      } catch (error) {
        logger.warn(`unable to load '${id}': ${error.message}`);
      }
    }
  }

  resolvePath(pathname) {
    return path.resolve(this.workDir, pathname || '');
  }

  resolveContentsPath(pathname) {
    return path.resolve(this.contentsPath, pathname || '');
  }

  resolveModule(module) {
    switch (module[0]) {
      case '.':
        return require.resolve(this.resolvePath(module));
      case '/':
        return require.resolve(module);
      default: {
        const nodeDir = this.resolvePath('node_modules');
        try {
          return require.resolve(path.join(nodeDir, module));
        } catch (error) {
          return require.resolve(module);
        }
      }
    }
  }

  relativePath(pathname) {
    return path.relative(this.workDir, pathname);
  }

  relativeContentsPath(pathname) {
    return path.relative(this.contentsPath, pathname);
  }

  registerContentPlugin(group, pattern, plugin) {
    this.logger.verbose(`registering content plugin ${plugin.name} that handles: ${pattern}`);
    this.plugins[plugin.name] = plugin;
    this.contentPlugins.push({
      group,
      pattern,
      class: plugin
    });
  }

  registerTemplatePlugin(pattern, plugin) {
    this.logger.verbose(`registering template plugin ${plugin.name} that handles: ${pattern}`);
    this.plugins[plugin.name] = plugin;
    this.templatePlugins.push({
      pattern,
      class: plugin
    });
  }

  registerGenerator(group, generator) {
    this.generators.push({
      group,
      fn: generator
    });
  }

  registerView(name, view) {
    this.views[name] = view;
  }

  getContentGroups() {
    const groups = [];
    for (const plugin of this.contentPlugins) {
      if (!groups.includes(plugin.group)) groups.push(plugin.group);
    }
    for (const generator of this.generators) {
      if (!groups.includes(generator.group)) groups.push(generator.group);
    }
    return groups;
  }

  loadModule(module, unloadOnReset = false) {
    this.logger.silly(`loading module: ${module}`);
    const id = this.resolveModule(module);
    this.logger.silly(`resolved: ${id}`);
    const rv = require(id);
    if (unloadOnReset) this.loadedModules.push(id);
    return rv;
  }

  loadPluginModule(module, callback) {
    let id = 'unknown';
    const done = (error) => {
      if (error) error.message = `Error loading plugin '${id}': ${error.message}`;
      callback(error);
    };

    if (typeof module === 'string') {
      id = module;
      try {
        module = this.loadModule(module);
      } catch (error) {
        done(error);
        return;
      }
    }

    try {
      module.call(null, this, done);
    } catch (error) {
      done(error);
    }
  }

  loadViewModule(id, callback) {
    this.logger.verbose(`loading view: ${id}`);
    try {
      const module = this.loadModule(id, true);
      this.registerView(path.basename(id), module);
      callback();
    } catch (error) {
      error.message = `Error loading view '${id}': ${error.message}`;
      callback(error);
    }
  }

  loadPlugins(callback) {
    async.series([
      (callback) => {
        async.forEachSeries(Environment.defaultPlugins, (plugin, callback) => {
          this.logger.verbose(`loading default plugin: ${plugin}`);
          const id = require.resolve(`../plugins/${plugin}`);
          const module = require(id);
          this.loadedModules.push(id);
          this.loadPluginModule(module, callback);
        }, callback);
      },
      (callback) => {
        async.forEachSeries(this.config.plugins, (plugin, callback) => {
          this.logger.verbose(`loading plugin: ${plugin}`);
          this.loadPluginModule(plugin, callback);
        }, callback);
      }
    ], callback);
  }

  loadViews(callback) {
    if (this.config.views == null) return callback();
    async.waterfall([
      (callback) => fs.readdir(this.resolvePath(this.config.views), callback),
      (filenames, callback) => {
        const modules = filenames.map((filename) => `${this.config.views}/${filename}`);
        async.forEach(modules, this.loadViewModule.bind(this), callback);
      }
    ], callback);
  }

  getContents(callback) {
    async.waterfall([
      (callback) => ContentTree.fromDirectory(this, this.contentsPath, callback),
      (contents, callback) => {
        async.mapSeries(this.generators, (generator, callback) => {
          runGenerator(this, contents, generator, callback);
        }, (error, generated) => {
          if (error != null || (generated != null && generated.length === 0)) {
            return callback(error, contents);
          }
          try {
            const tree = new ContentTree('', this.getContentGroups());
            for (const gentree of generated) {
              ContentTree.merge(tree, gentree);
            }
            ContentTree.merge(tree, contents);
            callback(null, tree);
          } catch (err) {
            callback(err);
          }
        });
      }
    ], callback);
  }

  getTemplates(callback) {
    loadTemplates(this, callback);
  }

  getLocals(callback) {
    callback(null, this.locals);
  }

  load(callback) {
    async.waterfall([
      (callback) => {
        async.parallel([
          (callback) => this.loadPlugins(callback),
          (callback) => this.loadViews(callback)
        ], callback);
      },
      (_, callback) => {
        async.parallel({
          contents: (callback) => this.getContents(callback),
          templates: (callback) => this.getTemplates(callback),
          locals: (callback) => this.getLocals(callback)
        }, callback);
      }
    ], callback);
  }

  preview(callback) {
    this.mode = 'preview';
    const server = require('./server');
    server.run(this, callback);
  }

  build(outputDir, callback) {
    this.mode = 'build';
    if (arguments.length < 2) {
      callback = typeof outputDir === 'function' ? outputDir : () => {};
      outputDir = this.resolvePath(this.config.output);
    }
    async.waterfall([
      (callback) => this.load(callback),
      (result, callback) => {
        const { contents, templates, locals } = result;
        render(this, outputDir, contents, templates, locals, callback);
      }
    ], callback);
  }
}

Environment.create = function (config, workDir, log = logger) {
  if (typeof config === 'string') {
    workDir = workDir != null ? workDir : path.dirname(config);
    config = Config.fromFileSync(config);
  } else {
    workDir = workDir != null ? workDir : process.cwd();
    if (!(config instanceof Config)) {
      config = new Config(config);
    }
  }
  return new Environment(config, workDir, log);
};

Environment.defaultPlugins = ['page', 'pug', 'markdown'];

module.exports = { Environment };
