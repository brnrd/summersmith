const { ContentTree, ContentPlugin } = require('./core/content');
const { Environment } = require('./core/environment');
const { TemplatePlugin } = require('./core/templates');

module.exports = (...args) => Environment.create.apply(null, args);
module.exports.Environment = Environment;
module.exports.ContentPlugin = ContentPlugin;
module.exports.ContentTree = ContentTree;
module.exports.TemplatePlugin = TemplatePlugin;
