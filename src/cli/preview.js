const async = require('async');
const util = require('util');
const { Config } = require('../core/config');
const { logger } = require('../core/logger');
const { loadEnv, commonUsage, commonOptions, extendOptions } = require('./common');

const usage = `
  usage: summersmith preview [options]

  options:

    -p, --port [port]             port to run server on (defaults to ${Config.defaults.port})
    -H, --hostname [host]         host to bind server onto (defaults to INADDR_ANY)
    ${commonUsage}

    all options can also be set in the config file

  examples:

    preview using a config file (assuming config.json is found in working directory):
    $ summersmith preview
`;

const options = {
  string: ['port', 'hostname'],
  alias: { port: 'p', hostname: 'H' }
};
extendOptions(options, commonOptions);

function preview(argv) {
  logger.info('starting preview server');

  async.waterfall([
    (callback) => loadEnv(argv, callback),
    (env, callback) => env.preview(callback)
  ], (error) => {
    if (error) {
      logger.error(error.message, error);
      process.exit(1);
    }
  });
}

module.exports = preview;
module.exports.usage = usage;
module.exports.options = options;
