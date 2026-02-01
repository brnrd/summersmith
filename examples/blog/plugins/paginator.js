module.exports = function (env, callback) {
  const defaults = {
    template: 'index.pug',
    articles: 'articles',
    first: 'index.html',
    filename: 'page/%d/index.html',
    perPage: 2
  };

  const options = env.config.paginator || {};
  for (const key of Object.keys(defaults)) {
    if (options[key] == null) options[key] = defaults[key];
  }

  function getArticles(contents) {
    let articles = contents[options.articles]._.directories.map((item) => item.index);
    articles = articles.filter((item) => item.template !== 'none');
    articles.sort((a, b) => b.date - a.date);
    return articles;
  }

  class PaginatorPage extends env.plugins.Page {
    constructor(pageNum, articles) {
      super();
      this.pageNum = pageNum;
      this.articles = articles;
    }

    getFilename() {
      if (this.pageNum === 1) {
        return options.first;
      }
      return options.filename.replace('%d', this.pageNum);
    }

    getView() {
      return (env, locals, contents, templates, callback) => {
        const template = templates[options.template];
        if (template == null) {
          return callback(new Error(`unknown paginator template '${options.template}'`));
        }
        const ctx = {
          articles: this.articles,
          pageNum: this.pageNum,
          prevPage: this.prevPage,
          nextPage: this.nextPage,
          page: this
        };
        env.utils.extend(ctx, locals);
        template.render(ctx, callback);
      };
    }
  }

  env.registerGenerator('paginator', (contents, callback) => {
    const articles = getArticles(contents);
    const numPages = Math.ceil(articles.length / options.perPage);
    const pages = [];
    for (let i = 0; i < numPages; i++) {
      const pageArticles = articles.slice(i * options.perPage, (i + 1) * options.perPage);
      pages.push(new PaginatorPage(i + 1, pageArticles));
    }
    for (let i = 0; i < pages.length; i++) {
      pages[i].prevPage = pages[i - 1];
      pages[i].nextPage = pages[i + 1];
    }
    const rv = { pages: {} };
    for (const page of pages) {
      rv.pages[`${page.pageNum}.page`] = page;
    }
    rv['index.page'] = pages[0];
    rv['last.page'] = pages[numPages - 1];
    callback(null, rv);
  });

  env.helpers.getArticles = getArticles;
  callback();
};
