const path = require('path');
const async = require('async');
const { Config } = require('../core/config');
const { Environment } = require('../core/environment');
const { logger } = require('../core/logger');
const { readJSON, fileExists } = require('../core/utils');

exports.commonOptions = {
  string: ['chdir', 'config', 'contents', 'templates', 'locals', 'require', 'plugins', 'ignore'],
  default: {
    config: './config.json',
    chdir: null
  },
  alias: {
    config: 'c',
    chdir: 'C',
    contents: 'i',
    templates: 't',
    locals: 'L',
    require: 'R',
    plugins: 'P',
    ignore: 'I'
  }
};

const defaults = exports.commonOptions;

exports.commonUsage = [
  '-C, --chdir [path]            change the working directory',
  `  -c, --config [path]           path to config (defaults to ${defaults.default.config})`,
  `  -i, --contents [path]         contents location (defaults to ${Config.defaults.contents})`,
  `  -t, --templates [path]        template location (defaults to ${Config.defaults.templates})`,
  '  -L, --locals [path]           optional path to json file containing template context data',
  '  -R, --require                 comma separated list of modules to add to the template context',
  '  -P, --plugins                 comma separated list of modules to load as plugins',
  '  -I, --ignore                  comma separated list of files/glob-patterns to ignore'
].join('\n');

exports.extendOptions = function (base, extra) {
  for (const type of ['string', 'boolean']) {
    base[type] = base[type] || [];
    if (extra[type] != null) {
      base[type] = base[type].concat(extra[type]);
    }
  }
  for (const type of ['alias', 'default']) {
    base[type] = base[type] || {};
    if (extra[type] != null) {
      for (const key of Object.keys(extra[type])) {
        base[type][key] = extra[type][key];
      }
    }
  }
};

exports.loadEnv = function (argv, callback) {
  const workDir = path.resolve(argv.chdir || process.cwd());
  logger.verbose(`creating environment - work directory: ${workDir}`);

  async.waterfall([
    (callback) => {
      const configPath = path.join(workDir, argv.config);
      fileExists(configPath, (exists) => {
        if (exists) {
          logger.info(`using config file: ${configPath}`);
          Config.fromFile(configPath, callback);
        } else {
          logger.verbose('no config file found');
          callback(null, new Config());
        }
      });
    },
    (config, callback) => {
      config._cliopts = {};
      const excluded = ['_', 'chdir', 'config', 'clean'];
      for (const key of Object.keys(argv)) {
        if (excluded.includes(key)) continue;
        let value = argv[key];
        if (value === undefined) continue;
        if (key === 'port') value = Number(value);
        if (['ignore', 'require', 'plugins'].includes(key) && typeof value === 'string') {
          value = value.split(',');
          if (key === 'require') {
            const reqs = {};
            for (const v of value) {
              const parts = v.split(':');
              let alias = parts[0];
              let module = parts[1];
              if (module == null) {
                module = alias;
                alias = module.replace(/\/$/, '').split('/').slice(-1)[0];
              }
              reqs[alias] = module;
            }
            value = reqs;
          }
        }
        config[key] = config._cliopts[key] = value;
      }
      callback(null, config);
    },
    (config, callback) => {
      logger.verbose('config:', config);
      const env = new Environment(config, workDir, logger);
      callback(null, env);
    },
    (env, callback) => {
      const paths = ['contents', 'templates'];
      async.forEach(paths, (pathname, callback) => {
        const resolved = env.resolvePath(env.config[pathname]);
        fileExists(resolved, (exists) => {
          if (exists) callback();
          else callback(new Error(`${pathname} path invalid (${resolved})`));
        });
      }, (error) => callback(error, env));
    }
  ], callback);
};

exports.getStorageDir = function () {
  if (process.env.SUMMERSMITH_PATH != null) return process.env.SUMMERSMITH_PATH;
  const home = process.env.HOME || process.env.USERPROFILE;
  let dir = 'summersmith';
  if (process.platform !== 'win32') dir = '.' + dir;
  return path.resolve(home, dir);
};
