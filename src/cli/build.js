const async = require('async');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { fileExistsSync } = require('../core/utils');
const { loadEnv, commonOptions, commonUsage, extendOptions } = require('./common');
const { logger } = require('../core/logger');

const usage = `
  usage: summersmith build [options]

  options:

    -o, --output [path]           directory to write build-output (defaults to ./build)
    -X, --clean                   clean before building (warning: will recursively delete everything at output path)
    ${commonUsage}

    all options can also be set in the config file

  examples:

    build using a config file (assuming config.json is found in working directory):
    $ summersmith build

    build using command line options:
    $ summersmith build -o /var/www/public/ -T extra_data.json -C ~/my-blog

    or using both (command-line options will override config options):
    $ summersmith build --config another_config.json --clean
`;

const options = {
  alias: { output: 'o', clean: 'X' },
  boolean: ['clean'],
  string: ['output']
};
extendOptions(options, commonOptions);

function build(argv) {
  const start = new Date();
  logger.info('building site');

  const prepareOutputDir = (env, callback) => {
    const outputDir = env.resolvePath(env.config.output);
    const exists = fileExistsSync(outputDir);
    if (exists) {
      if (argv.clean) {
        logger.verbose(`cleaning ${outputDir}`);
        async.series([
          (callback) => fs.rm(outputDir, { recursive: true, force: true }, callback),
          (callback) => fs.mkdir(outputDir, callback)
        ], callback);
      } else {
        callback();
      }
    } else {
      logger.verbose(`creating output directory ${outputDir}`);
      fs.mkdir(outputDir, callback);
    }
  };

  async.waterfall([
    (callback) => loadEnv(argv, callback),
    (env, callback) => prepareOutputDir(env, (error) => callback(error, env)),
    (env, callback) => env.build(callback)
  ], (error) => {
    if (error) {
      logger.error(error.message, error);
      process.exit(1);
    } else {
      const stop = new Date();
      const delta = stop - start;
      logger.info(`done in ${chalk.bold(delta)} ms\n`);
      process.exit();
    }
  });
}

module.exports = build;
module.exports.usage = usage;
module.exports.options = options;
