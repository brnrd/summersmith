const async = require('async');
const fs = require('fs');
const hljs = require('highlight.js');
const marked = require('marked');
const path = require('path');
const url = require('url');
const yaml = require('js-yaml');

// Monkeypatch marked for custom link resolution (relative URLs in content tree)
if (marked.InlineLexer && marked.InlineLexer.prototype._outputLink == null) {
  marked.InlineLexer.prototype._outputLink = marked.InlineLexer.prototype.outputLink;
  marked.InlineLexer.prototype._resolveLink = (href) => href;
  marked.InlineLexer.prototype.outputLink = function (cap, link) {
    link.href = this._resolveLink(link.href);
    return this._outputLink(cap, link);
  };
}

function resolveLink(content, uri, baseUrl) {
  const uriParts = url.parse(uri);
  if (uriParts.protocol) {
    return uri;
  } else if (uriParts.hash === uri) {
    return uri;
  } else {
    let nav = content.parent;
    const pathParts = (uriParts.pathname && uriParts.pathname.split('/')) || [];
    while (pathParts.length && nav != null) {
      const part = pathParts.shift();
      if (part === '') {
        while (nav.parent) nav = nav.parent;
      } else if (part === '..') {
        nav = nav.parent;
      } else {
        nav = nav[part];
      }
    }
    if (nav != null && nav.getUrl != null) {
      return nav.getUrl() + (uriParts.hash || '');
    }
    return url.resolve(baseUrl, uri);
  }
}

function parseMarkdownSync(content, markdown, baseUrl, options) {
  if (marked.InlineLexer && marked.InlineLexer.prototype._resolveLink) {
    marked.InlineLexer.prototype._resolveLink = (uri) => resolveLink(content, uri, baseUrl);
  }

  const parseOptions = { ...options };
  parseOptions.highlight = (code, lang) => {
    try {
      if (lang === 'auto') {
        return hljs.highlightAuto(code).value;
      }
      // highlight.js v11: highlight(code, { language: lang })
      const result = hljs.highlight(code, { language: lang || 'plaintext' });
      return result.value;
    } catch (error) {
      // ignore
    }
    return code;
  };

  // marked 9+: parse(markdown, options); older: setOptions + parse
  if (typeof marked.parse === 'function') {
    return marked.parse(markdown, parseOptions);
  }
  marked.setOptions(parseOptions);
  return marked(markdown);
}

module.exports = function (env, callback) {
  const hljsConfigDefaults = { classPrefix: '' };
  const hljsConfig = env.config.highlightjs || {};
  for (const key of Object.keys(hljsConfigDefaults)) {
    if (hljsConfig[key] == null) hljsConfig[key] = hljsConfigDefaults[key];
  }
  hljs.configure(hljsConfig);

  class MarkdownPage extends env.plugins.Page {
    constructor(filepath, metadata, markdown) {
      super();
      this.filepath = filepath;
      this.metadata = metadata;
      this.markdown = markdown;
    }

    getLocation(base) {
      const uri = this.getUrl(base);
      return uri.slice(0, uri.lastIndexOf('/') + 1);
    }

    getHtml(base = env.config.baseUrl) {
      const options = env.config.markdown || {};
      return parseMarkdownSync(this, this.markdown, this.getLocation(base), options);
    }
  }

  MarkdownPage.fromFile = function (filepath, callback) {
    async.waterfall([
      (callback) => fs.readFile(filepath.full, callback),
      (buffer, callback) => MarkdownPage.extractMetadata(buffer.toString(), callback),
      (result, callback) => {
        const { markdown, metadata } = result;
        const page = new this(filepath, metadata, markdown);
        callback(null, page);
      }
    ], callback);
  };

  MarkdownPage.extractMetadata = function (content, callback) {
    function parseMetadata(source, callback) {
      if (source.length === 0) return callback(null, {});
      try {
        callback(null, yaml.load(source) || {});
      } catch (error) {
        if (error.problem != null && error.problemMark != null) {
          const lines = error.problemMark.buffer.split('\n');
          const markerPad = Array(error.problemMark.column).fill(' ').join('');
          error.message = `YAML: ${error.problem}\n\n${lines[error.problemMark.line]}\n${markerPad}^\n`;
        } else {
          error.message = `YAML Parsing error ${error.message}`;
        }
        callback(error);
      }
    }

    let metadata = '';
    let markdown = content;

    if (content.slice(0, 3) === '---') {
      const result = content.match(/^-{3,}\s([\s\S]*?)-{3,}(\s[\s\S]*|\s?)$/);
      if (result != null && result.length === 3) {
        metadata = result[1];
        markdown = result[2];
      }
    } else if (content.slice(0, 12) === '```metadata\n') {
      const end = content.indexOf('\n```\n');
      if (end !== -1) {
        metadata = content.substring(12, end);
        markdown = content.substring(end + 5);
      }
    }

    async.parallel({
      metadata: (callback) => parseMetadata(metadata, callback),
      markdown: (callback) => callback(null, markdown)
    }, callback);
  };

  MarkdownPage.resolveLink = resolveLink;

  class JsonPage extends MarkdownPage {
    static fromFile(filepath, callback) {
      async.waterfall([
        (callback) => env.utils.readJSON(filepath.full, callback),
        (metadata, callback) => {
          const markdown = metadata.content || '';
          const page = new this(filepath, metadata, markdown);
          callback(null, page);
        }
      ], callback);
    }
  }

  env.registerContentPlugin('pages', '**/*.*(markdown|mkd|md)', MarkdownPage);
  env.registerContentPlugin('pages', '**/*.json', JsonPage);
  callback();
};
