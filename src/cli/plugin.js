const async = require('async');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');
const { loadEnv, commonOptions, extendOptions } = require('./common');
const { fileExists, readJSON } = require('../core/utils');
const { logger } = require('../core/logger');

const usage = `
  usage: summersmith plugin [options] <command>

  commands:

    ${chalk.bold('list')} - list available plugins
    ${chalk.bold('install')} <plugin> - install plugin (runs 'npm install' via CLI)

  options:

    -C, --chdir [path]      change the working directory
    -c, --config [path]     path to config

  note: 'plugin install' uses the npm CLI (your system's npm). Summersmith no
  longer uses npm's programmatic API, which was removed in npm v8.
`;

const options = {};
extendOptions(options, commonOptions);

function max(array, get) {
  if (get == null) get = (item) => item;
  let rv = null;
  for (const item of array) {
    const v = get(item);
    if (v > rv) rv = v;
  }
  return rv;
}

function lpad(string, amount, char = ' ') {
  let p = '';
  for (let i = 0; i < amount - string.length; i++) p += char;
  return p + string;
}

function clip(string, maxlen) {
  if (string.length <= maxlen) return string;
  return string.slice(0, maxlen - 2).trim() + '..';
}

function fetchListing(callback) {
  const request = https.get('https://api.npms.io/v2/search?q=keywords:summersmith-plugin+OR+keywords:wintersmith-plugin&size=200', (response) => {
    let error;
    if (response.statusCode !== 200) {
      error = new Error(`Unexpected response when searching registry, HTTP ${response.statusCode}`);
    }
    if (!/^application\/json/.test(response.headers['content-type'])) {
      error = new Error(`Invalid content-type: ${response.headers['content-type']}`);
    }
    if (error != null) {
      response.resume();
      callback(error);
      return;
    }
    const data = [];
    response.on('data', (chunk) => data.push(chunk));
    response.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(data));
      } catch (err) {
        callback(err);
        return;
      }
      const listing = parsed.results.map((result) => result.package);
      listing.sort((a, b) => {
        if (a.name > b.name) return 1;
        if (a.name < b.name) return -1;
        return 0;
      });
      callback(null, listing);
    });
  });
}

function displayListing(list, callback) {
  const display = list.map((plugin) => ({
    name: normalizePluginName(plugin.name),
    description: plugin.description,
    maintainers: plugin.maintainers.map((v) => v.username).join(' '),
    homepage: (plugin.links && plugin.links.homepage) || plugin.links?.npm
  }));
  const pad = max(display, (item) => item.name.length);
  const maxw = process.stdout.getWindowSize()[0] - 2;
  const margin = Array(pad).fill(' ').join('');

  for (const plugin of display) {
    let line = `${lpad(plugin.name, pad)}  ${clip(plugin.description, maxw - pad - 2)}`;
    const left = maxw - line.length;
    if (left > plugin.maintainers.length) {
      line += chalk.grey(lpad(plugin.maintainers, left));
    }
    logger.info(line.replace(/^\s*(\S+)  /, (m) => chalk.bold(m)));
    if (plugin.homepage != null && plugin.homepage.length < maxw - pad - 2) {
      logger.info(`${margin}  ${chalk.gray(plugin.homepage)}`);
    }
    logger.info('');
  }
  callback(null, list);
}

function waterfall(flow, callback) {
  const resolved = [];
  for (const item of flow) {
    switch (typeof item) {
      case 'function':
        resolved.push(item);
        break;
      case 'object':
        resolved.push(async.apply(async.parallel, item));
        break;
      default:
        return callback(new Error(`Invalid item '${item}' in flow`));
    }
  }
  async.waterfall(resolved, callback);
}

function normalizePluginName(name) {
  return name.replace(/^summersmith\-|^wintersmith\-/, '');
}

function main(argv) {
  const action = argv._[3];

  if (action == null) {
    console.log(usage);
    process.exit(0);
  }

  const loadCurrentEnv = (callback) => loadEnv(argv, callback);

  const installPlugin = (res, callback) => {
    const [env, list] = res;
    const name = argv._[4];
    let plugin = null;
    for (const p of list) {
      if (normalizePluginName(p.name) === normalizePluginName(name)) {
        plugin = p;
        break;
      }
    }
    if (plugin == null) {
      return callback(new Error(`Unknown plugin: ${name}`));
    }

    const configFile = env.config.__filename;
    const packageFile = env.resolvePath('package.json');

    const createPackageJson = (callback) => {
      fileExists(packageFile, (exists) => {
        if (exists) callback();
        else {
          logger.warn('package.json missing, creating minimal package');
          fs.writeFile(packageFile, '{\n  "dependencies": {},\n  "private": true\n}\n', callback);
        }
      });
    };

    const readConfig = (callback) => readJSON(configFile, callback);

    const updateConfig = (config, callback) => {
      config.plugins = config.plugins || [];
      if (!config.plugins.includes(plugin.name)) {
        config.plugins.push(plugin.name);
      }
      callback(null, config);
    };

    const saveConfig = (config, callback) => {
      logger.verbose(`saving config file: ${configFile}`);
      const json = JSON.stringify(config, null, 2);
      fs.writeFile(configFile, json + '\n', callback);
    };

    const install = (callback) => {
      logger.verbose(`installing ${plugin.name} via npm CLI`);
      async.series([
        createPackageJson,
        (callback) => {
          const child = spawn('npm', ['install', '--save', plugin.name], {
            cwd: env.workDir,
            stdio: 'inherit',
            shell: true
          });
          child.on('error', (err) => callback(err));
          child.on('close', (code) => callback(code === 0 ? null : new Error(`npm install exited with code ${code}`)));
        }
      ], (error) => callback(error));
    };

    async.waterfall([install, readConfig, updateConfig, saveConfig], callback);
  };

  let cmd;
  switch (action) {
    case 'list':
      cmd = [fetchListing, displayListing];
      break;
    case 'install':
      cmd = [[loadCurrentEnv, fetchListing], installPlugin];
      break;
    default:
      cmd = [(callback) => callback(new Error(`Unknown plugin action: ${action}`))];
  }

  waterfall(cmd, (error) => {
    if (error != null) {
      logger.error(error.message, error);
      process.exit(1);
    } else {
      process.exit(0);
    }
  });
}

module.exports = main;
module.exports.usage = usage;
module.exports.options = options;
