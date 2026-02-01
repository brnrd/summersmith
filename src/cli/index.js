const chalk = require('chalk');
const parseArgv = require('minimist');
const path = require('path');
const { logger } = require('../core/logger');
const { extendOptions } = require('./common');

const usage = `
  usage: summersmith [options] [command]

  commands:

    ${chalk.bold('build')} [options] - build a site
    ${chalk.bold('preview')} [options] - run local webserver
    ${chalk.bold('new')} <location> - create a new site
    ${chalk.bold('plugin')} - manage plugins

    also see [command] --help

  global options:

    -v, --verbose   show debug information
    -q, --quiet     only output critical errors
    -V, --version   output version and exit
    -h, --help      show help
`;

const globalOptions = {
  boolean: ['verbose', 'quiet', 'version', 'help'],
  alias: {
    verbose: 'v',
    quiet: 'q',
    version: 'V',
    help: 'h'
  }
};

function main(argv) {
  let opts = parseArgv(argv, globalOptions);
  let cmd = opts._[2];

  if (cmd != null) {
    try {
      cmd = require(`./${cmd}`);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.log(`'${cmd}' - no such command`);
        process.exit(1);
      }
      throw error;
    }
  }

  if (opts.version) {
    console.log(require('./version'));
    process.exit(0);
  }

  if (opts.help || !cmd) {
    console.log(cmd ? cmd.usage : usage);
    process.exit(0);
  }

  if (opts.verbose) {
    logger.transports[0].level = argv.includes('-vv') ? 'silly' : 'verbose';
  }

  if (opts.quiet) {
    logger.transports[0].quiet = true;
  }

  if (cmd) {
    extendOptions(cmd.options, globalOptions);
    opts = parseArgv(argv, cmd.options);
    cmd(opts);
  }
}

module.exports.main = main;
