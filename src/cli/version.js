const path = require('path');
const { readJSONSync } = require('../core/utils');
const version = readJSONSync(path.join(__dirname, '../../package.json')).version;
module.exports = version;
