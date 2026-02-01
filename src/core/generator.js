const { ContentPlugin, ContentTree } = require('./content');

function runGenerator(env, contents, generator, callback) {
  const groups = env.getContentGroups();

  function resolve(root, items) {
    for (const key of Object.keys(items)) {
      const item = items[key];
      if (item instanceof ContentPlugin) {
        item.parent = root;
        item.__env = env;
        item.__filename = 'generator';
        item.__plugin = generator;
        root[key] = item;
        root._[generator.group].push(item);
      } else if (item instanceof Object) {
        const tree = new ContentTree(key, groups);
        tree.parent = root;
        tree.parent._.directories.push(tree);
        root[key] = tree;
        resolve(root[key], item);
      } else {
        throw new Error(`Invalid item for '${key}' encountered when resolving generator output`);
      }
    }
  }

  generator.fn(contents, (error, generated) => {
    const tree = new ContentTree('', groups);
    try {
      resolve(tree, generated);
    } catch (err) {
      return callback(err);
    }
    callback(null, tree);
  });
}

module.exports = { runGenerator };
