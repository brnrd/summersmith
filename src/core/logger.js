const chalk = require('chalk');
const winston = require('winston');
const util = require('util');

class Cli extends winston.Transport {
  constructor(options) {
    super(options);
    this.name = 'cli';
    this.quiet = options.quiet || false;
  }

  log(info, callback) {
    const { level, message } = info;
    const meta = info.meta || {};
    if (level === 'error') {
      process.stderr.write(`\n  ${chalk.red('error')} ${message}\n`);
      if (this.level === 'verbose' && meta != null) {
        if (meta.stack != null) {
          const stack = meta.stack.substr(meta.stack.indexOf('\n') + 1);
          process.stderr.write(stack + '\n\n');
        }
        for (const key of Object.keys(meta)) {
          if (['message', 'stack'].includes(key)) continue;
          const pval = util.inspect(meta[key], false, 2, true).replace(/\n/g, '\n    ');
          process.stderr.write(`    ${key}: ${pval}\n`);
        }
      } else {
        process.stderr.write('\n');
      }
    } else if (!this.quiet) {
      let msg = message;
      if (level !== 'info') {
        const c = level === 'warn' ? 'yellow' : 'grey';
        msg = chalk[c](level) + ' ' + message;
      }
      if (Object.keys(meta).length > 0) {
        msg += util.format(' %j', meta);
      }
      process.stdout.write('  ' + msg + '\n');
    }
    this.emit('logged');
    callback(null, true);
  }
}

const transports = [
  new Cli({ level: 'info' })
];

const logger = winston.createLogger({
  exitOnError: true,
  transports
});

module.exports = { logger, transports };
