const path = require('path');
const async = require('async');
const slugify = require('slugg');

function replaceAll(string, map) {
  const re = new RegExp(Object.keys(map).join('|'), 'gi');
  return string.replace(re, (match) => map[match]);
}

module.exports = function (env, callback) {
  function templateView(env, locals, contents, templates, callback) {
    if (this.template === 'none') {
      return callback(null, null);
    }
    const template = templates[path.normalize(this.template)];
    if (template == null) {
      callback(new Error(`page '${this.filename}' specifies unknown template '${this.template}'`));
      return;
    }
    const ctx = { page: this };
    env.utils.extend(ctx, locals);
    template.render(ctx, callback);
  }

  class Page extends env.ContentPlugin {
    constructor(filepath, metadata) {
      super();
      this.filepath = filepath;
      this.metadata = metadata;
    }

    getFilename() {
      const template = this.filenameTemplate;
      const dirname = path.dirname(this.filepath.relative);
      const basename = path.basename(this.filepath.relative);
      const file = env.utils.stripExtension(basename);
      const ext = path.extname(basename);

      let filename = replaceAll(template, {
        ':year': this.date.getFullYear(),
        ':month': ('0' + (this.date.getMonth() + 1)).slice(-2),
        ':day': ('0' + this.date.getDate()).slice(-2),
        ':title': slugify(this.title + ''),
        ':file': file,
        ':ext': ext,
        ':basename': basename,
        ':dirname': dirname
      });

      let vm = null;
      let ctx = null;
      filename = filename.replace(/\{\{(.*?)\}\}/g, (match, code) => {
        if (vm == null) vm = require('vm');
        if (ctx == null) ctx = vm.createContext({ env, page: this });
        return vm.runInContext(code, ctx);
      });

      if (filename[0] === '/') {
        return filename.slice(1);
      } else {
        return path.join(dirname, filename);
      }
    }

    getUrl(base) {
      return super.getUrl(base).replace(/([\/^])index\.html$/, '$1');
    }

    getView() {
      return this.metadata.view || 'template';
    }

    getHtml(base = env.config.baseUrl) {
      throw new Error('Not implemented.');
    }

    getIntro(base) {
      const html = this.getHtml(base);
      const cutoffs = env.config.introCutoffs || ['<span class="more', '<h2', '<hr'];
      let idx = Infinity;
      for (const cutoff of cutoffs) {
        const i = html.indexOf(cutoff);
        if (i !== -1 && i < idx) idx = i;
      }
      if (idx !== Infinity) {
        return html.substr(0, idx);
      }
      return html;
    }

    get filenameTemplate() {
      return this.metadata.filename || env.config.filenameTemplate || ':file.html';
    }

    get template() {
      return this.metadata.template || env.config.defaultTemplate || 'none';
    }

    get title() {
      return this.metadata.title || 'Untitled';
    }

    get date() {
      return new Date(this.metadata.date || 0);
    }

    get rfc822date() {
      return env.utils.rfc822(this.date);
    }

    get hasMore() {
      if (this._html == null) this._html = this.getHtml();
      if (this._intro == null) this._intro = this.getIntro();
      if (this._hasMore == null) this._hasMore = this._html.length > this._intro.length;
      return this._hasMore;
    }
  }

  env.plugins.Page = Page;
  env.registerView('template', templateView);
  callback();
};
