const fs = require('fs-extra');
const path = require('path');
const url = require('url');
const _ = require('underscore');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const sass = require('sass');
const marked = require('marked');

/**
 * Regex to match hidden pages (filename starts with `_`).
 * Github/Gitlab proposal.
 * @type {RegExp}
 */
const HIDDEN_PAGE = /^_/i;

/**
 * Regex to match home page.
 * Github/Gitlab proposal.
 * @type {RegExp}
 */
const HOME_PAGE = /home\.md/i;

/**
 * Default project icon.
 * @type {String}
 */
const LOGO = 'https://logos.chialab.io/undefined.svg';

/**
 * The template base path.
 * In a future, it could be configurable.
 */
const TEMPLATE = path.resolve(__dirname, '../../../configs/wiki/template');

/**
 * Auto generate TOC for pages.
 * If Github/Gitlab _sidebar is found, use it.
 *
 * @param {Array<string>} pages A list of pages files.
 * @return {String} The html markup for the TOC.
 */
function generateToc(pages) {
    let keys = Object.keys(pages);
    for (let i = 0; i < keys.length; i++) {
        // search for Github/Gitlab `_sidebar` file.
        let key = keys[i];
        if (key.match(/_sidebar/i)) {
            return pages[key];
        }
    }
    // auto generate a list of pages links.
    return `<ul>${
        keys
            .filter((pagename) => !pagename.match(HIDDEN_PAGE))
            .map((pagename) => `<li><a href="${pagename}">${path.basename(pagename, '.md')}</a></li>`)
            .join('')
    }</ul>`;
}

/**
 * Convert repository git url to repository homepage.
 * Only Github and Gitlab respositories are supported.
 * @param {String|Object} repo Package.json `respostitory` field.
 * @return {String}
 */
function repoToUrl(repo) {
    if (typeof repo !== 'string') {
        // if repo is an object, use its `url` field.
        repo = repo.url;
    }
    if (repo.match(/(github|gitlab)/)) {
        // replace git url to homepage url.
        return repo.replace(/^(?:.*)(github|gitlab).com(?::|\/)(.*).git/, 'https://$1.com/$2');
    }
    return repo;
}

/**
 * Convert repository git url to repository releases page.
 * Only Github and Gitlab respositories are supported.
 * @param {String|Object} repo Package.json `respostitory` field.
 * @return {String}
 */
function repoToRelease(repo) {
    if (typeof repo !== 'string') {
        // if repo is an object, use its `url` field.
        repo = repo.url;
    }
    if (repo.match('github')) {
        // convert git url to Github releases page
        return repo.replace(/^(?:.*)github.com(?::|\/)(.*).git/, 'https://github.com/$1/releases');
    }
    if (repo.match('gitlab')) {
        // convert git url to Gitlab tags page
        return repo.replace(/^(?:.*)gitlab.com(?::|\/)(.*).git/, 'https://gitlab.com/$1/tags');
    }
    return '';
}

/**
 * Extract author name from package.json `author` field.
 * Format: Fullname <mail@address.com> (http://author-website)
 * @param {String} author The json field.
 * @return {String}
 */
function authorToName(author) {
    return author
        .replace(/<[^>]*>/, '')
        .replace(/\([^)]*\)/, '')
        .trim();
}

/**
 * Extract author homepage from package.json `author` field.
 * Format: Fullname <mail@address.com> (http://author-website)
 * @param {String} author The json field.
 * @return {String}
 */
function authorToHome(author) {
    let match = author.match(/\(([^)]*)\)/);
    if (match) {
        return match[1];
    }
    return '';
}

/**
 * Extract author email from package.json `author` field.
 * Format: Fullname <mail@address.com> (http://author-website)
 * @param {String} author The json field.
 * @return {String}
 */
function authorToEMail(author) {
    let match = author.match(/<([^>]*)>/);
    if (match) {
        return match[1];
    }
    return '';
}

/**
 * Add missing protocol to url.
 * @param {String} endpoint The url to check.
 * @return {String}
 */
function ensureProtocol(endpoint) {
    let parsed = url.parse(endpoint);
    if (parsed.protocol) {
        // url aready has the protocol.
        return endpoint;
    }
    // missing protocol.
    return `https://${endpoint}`;
}

module.exports = {
    /**
     * Generate underscore template.
     * @param {String} partial The filename of the template.
     * @return {Function}
     */
    template(partial) {
        let p = path.join(TEMPLATE, partial);
        // get file content.
        let tpl = fs.readFileSync(p, 'utf8');
        // generate underscore template.
        return _.template(tpl);
    },

    /**
     * Prepare data for the template.
     * @param {Object} input The package.json object.
     * @param {Object} extra Extra data to add.
     * @return {Object}
     */
    json(input, extra = {}) {
        return Object.assign({
            // Get the title removing the package scope from the name.
            title: (input.name || '').split('/').pop(),
            // Get the project scope
            scope: (input.name || '').split('/').shift().replace('@', ''),
            name: input.name || '',
            version: input.version,
            description: input.description || '',
            logo: LOGO,
            keywords: (input.keywords || []).join(' '),
            // Get repository homepage
            repository: repoToUrl(input.repository || ''),
            // Get project homepage
            homepage: ensureProtocol(input.homepage || ''),
            // Get author name
            author: authorToName(input.author || ''),
            // Get author homepage
            authorLink: authorToHome(input.author || ''),
            // Get author email
            authorMail: authorToEMail(input.author || ''),
            // Get project releases page
            releases: repoToRelease(input.repository || ''),
            workspaces: input.workspaces ? input.workspaces : null,
        }, {
            extra,
        });
    },

    /**
     * Copy template assets.
     * @param {String} output The output path of the wiki.
     * @param {Array<string>} [assets] A list of extra assets.
     * @return {Promise}
     */
    assets(output, assets = []) {
        let dest = path.join(output, 'img');
        fs.ensureDirSync(dest);
        fs.copySync(path.join(TEMPLATE, 'img'), dest);
        assets.map((file) => fs.copySync(file, path.join(dest, path.basename(file))));
        return global.Promise.resolve();
    },

    /**
     * Use sass to generated wiki styles.
     * @param {String} output The output path of the wiki.
     * @return {Promise}
     */
    css(output) {
        let source = path.join(TEMPLATE, 'index.scss');
        let p = path.join(output, 'index.css');
        return new global.Promise((resolve, reject) => {
            // sass
            sass.render({
                file: source,
                outFile: p,
            }, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    // autoprefixer
                    postcss([autoprefixer({
                        browsers: 'last 3 versions',
                    })]).process(result.css).then((finalRes) => {
                        // rwite the file
                        fs.writeFileSync(p, finalRes.css);
                        resolve();
                    });
                }
            });
        });
    },

    /**
     * Generate the index file.
     * @param {String} output The output path of the wiki.
     * @param {Object} data The template data.
     * @param {Array<string>} pages A list of pages.
     * @param {Array<string>} assets A list of assets.
     * @return {Promise}
     */
    index(output, data, pages, assets) {
        let template = this.template('index.html');
        let p = path.join(output, 'index.html');
        data.content = '';
        if (pages) {
            // if there is the home page, use it for the content
            let home = pages.find((file) => !!file.match(HOME_PAGE));
            if (fs.existsSync(home)) {
                data.content = marked(fs.readFileSync(home, 'utf8'));
            }
        }
        data.toc = null;
        data.pages = pages.length;
        fs.ensureFileSync(p);
        // generate the file
        try {
            fs.writeFileSync(p, template(data));
            return global.Promise.all([
                // generate styles
                this.css(output),
                // copy assets
                this.assets(output, assets),
            ]);
        } catch (err) {
            return global.Promise.reject(err);
        }
    },

    /**
     * Convert .md files to html pages.
     * @param {String} output The output path of the wiki.
     * @param {Object} data The template data.
     * @param {Array<string>} pages A list of pages.
     * @return {Promise}
     */
    pages(output, data, pages) {
        if (pages.length) {
            // create the pages folder
            let docPath = path.join(output, 'pages');
            fs.ensureDirSync(docPath);
            // generate html files
            let template = this.template('index.html');
            let generated = {};
            pages.forEach((file) => {
                generated[path.basename(file)] = marked(fs.readFileSync(file, 'utf8'));
            });
            // generate the toc
            let toc = generateToc(generated);
            let tocPath = path.join(docPath, 'index.html');
            data.pages = pages.length;
            data.content = toc;
            data.toc = null;
            fs.writeFileSync(tocPath, template(data));
            Object.keys(generated)
                // filter hidden and home pages
                .filter((page) => page && !page.match(HIDDEN_PAGE) && !page.match(HOME_PAGE))
                // generate the file page
                .forEach((pagename) => {
                    let page = generated[pagename];
                    let p = pagename.replace('.md', '.html');
                    p = path.join(docPath, p.toLowerCase());
                    data.toc = toc;
                    data.content = page;
                    fs.writeFileSync(p, template(data));
                });
        }
        return global.Promise.resolve();
    },

    /**
     * Generate 404 page.
     * @param {String} output The output path of the wiki.
     * @param {Object} data The template data.
     * @param {Array<string>} pages A list of pages.
     * @return {Promise}
     */
    missing(output, data, pages) {
        let template = this.template('index.html');
        let p = path.join(output, '404.html');
        data.content = `
        <h2>404</h2>
        <p>Missing content. Back to <a href="/">home</a>.</p>`;
        data.toc = null;
        data.pages = pages.length;
        fs.writeFileSync(p, template(data));
        return global.Promise.resolve();
    },
};
