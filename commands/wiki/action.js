const fs = require('fs-extra');
const path = require('path');
const colors = require('colors/safe');
const glob = require('glob');
const Proteins = require('@chialab/proteins');
const paths = require('../../lib/paths.js');
const optionsUtils = require('../../lib/options.js');
const generator = require('./lib/generator.js');

/**
 * Generate the wiki for the given package.
 *
 * @param {CLI} app CLI instance.
 * @param {String} project The absolute path to the project.
 * @param {Object} options Options for the build.
 * @return {Promise}
 */
function generate(app, project, options) {
    let task = app.log(`Generating docs... ${colors.grey(`(${options.output})`)}`, true);
    let jsonPath = path.join(project, 'package.json');
    // get the projection definition from its package.json.
    let json = generator.json(require(jsonPath));
    // get projects markdown pages if the option is passed.
    let pages = (options.pages ? glob.sync(options.pages, { cwd: project }) : []).map((f) => path.resolve(project, f));
    let assets = [];
    // handle the logo
    if (options.logo) {
        if (!options.logo.match(/^https?:\/\//)) {
            // is local path
            json.logo = `/img/${path.basename(options.logo)}`;
            assets.push(path.resolve(project, options.logo));
        } else {
            json.logo = options.logo;
        }
    }
    // ensure the output path exists (and empty it).
    fs.ensureDirSync(options.output);
    fs.emptyDirSync(options.output);
    // generate the index
    return generator.index(options.output, Proteins.clone(json), pages, assets)
        // generate the 404 page
        .then(() => generator.missing(options.output, Proteins.clone(json), pages))
        // generate pages
        .then(() => generator.pages(options.output, Proteins.clone(json), pages))
        .then(() => {
            task();
            app.log(`${colors.bold(colors.green('Wiki generated.'))} ${colors.grey(`(${options.output})`)}`);
            return global.Promise.resolve();
        })
        .catch((err) => {
            if (err) {
                app.log(err);
            }
            app.log(`${colors.red('Failed to generate the wiki.')} ${colors.grey(`(${options.output})`)}`);
            return global.Promise.reject();
        });
}

/**
 * Command action to build sources.
 *
 * @param {CLI} app CLI instance.
 * @param {Object} options Options.
 * @returns {Promise}
 *
 * @namespace options
 * @property {String} pages The markdown files path.
 * @property {String} output The output path.
 * @property {String} logo The project logo.
 */
module.exports = (app, options = {}) => {
    options = Proteins.clone(options);
    let input = options.arguments[0] || paths.cwd;
    if (!input) {
        // Unable to detect project root.
        app.log(colors.red('no project found.'));
        return global.Promise.reject();
    }
    if (!options.output) {
        // missin output option.
        app.log(colors.red('Missing \'output\' property'));
        return global.Promise.reject();
    }

    let filter = optionsUtils.handleArguments(options);
    return generate(app, input, {
        output: path.resolve(input, options.output),
        pages: options.pages,
        packages: filter.packages,
        logo: options.logo,
    });
};
