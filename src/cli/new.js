const async = require('async');
const fs = require('fs');
const path = require('path');
const { getStorageDir } = require('./common');
const { fileExists, fileExistsSync } = require('../core/utils');
const { logger } = require('../core/logger');

const templates = {};
function loadTemplates(directory) {
  if (!fileExistsSync(directory)) return;
  fs.readdirSync(directory)
    .map((filename) => path.join(directory, filename))
    .filter((filename) => fs.statSync(filename).isDirectory())
    .forEach((filename) => { templates[path.basename(filename)] = filename; });

}
loadTemplates(path.join(__dirname, '../../examples/'));
loadTemplates(path.join(getStorageDir(), 'templates/'));

const usage = `
  usage: summersmith new [options] <path>

  creates a skeleton site in <path>

  options:

    -f, --force             overwrite existing files
    -T, --template <name>   template to create new site from (defaults to 'blog')

    available templates are: ${Object.keys(templates).join(', ')}

  note: After creating a site, run 'npm install' in the new directory if the
  template has a package.json (e.g. the blog template). Summersmith no longer
  runs npm programmatically; use your system's npm CLI.

  example:

    create a new site in your home directory
    $ summersmith new ~/my-blog
    $ cd ~/my-blog && npm install
`;

const options = {
  string: ['template'],
  boolean: ['force'],
  alias: { force: 'f', template: 'T' },
  default: { template: 'blog' }
};

function createSite(argv) {
  const location = argv._[3];
  if (location == null || location.length === 0) {
    logger.error('you must specify a location');
    return;
  }

  if (templates[argv.template] == null) {
    logger.error(`unknown template '${argv.template}'`);
    return;
  }

  const from = templates[argv.template];
  const to = path.resolve(location);

  logger.info(`initializing new summersmith site in ${to} using template ${argv.template}`);

  const validateDestination = (callback) => {
    logger.verbose(`checking validity of ${to}`);
    fileExists(to, (exists) => {
      if (exists && !argv.force) {
        callback(new Error(`${to} already exists. Add --force to overwrite`));
      } else {
        callback();
      }
    });
  };

  const copyTemplate = (callback) => {
    logger.verbose(`recursive copy ${from} -> ${to}`);
    fs.cp(from, to, { recursive: true }, callback);
  };

  const remindNpmInstall = (callback) => {
    const packagePath = path.join(to, 'package.json');
    fileExists(packagePath, (exists) => {
      if (exists) {
        logger.info(`Run 'npm install' in ${to} to install template dependencies.`);
      }
      callback();
    });
  };

  async.series([validateDestination, copyTemplate, remindNpmInstall], (error) => {
    if (error) {
      logger.error(error.message, error);
      process.exit(1);
    } else {
      logger.info('done!');
    }
  });
}

module.exports = createSite;
module.exports.usage = usage;
module.exports.options = options;
