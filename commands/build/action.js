const fs = require('fs-extra');
const path = require('path');
const colors = require('colors/safe');
const Proteins = require('@chialab/proteins');
const Entry = require('../../lib/entry.js');
const Watcher = require('../../lib/Watcher');
const ext = require('../../lib/extensions.js');
const browserslist = require('../../lib/browserslist.js');
const PriorityQueues = require('../../lib/PriorityQueues');
const utils = require('../../lib/utils.js');

async function rollup(app, options, profiler) {
    const Rollup = require('../../lib/Bundlers/Rollup.js');

    if (options.production && !process.env.hasOwnProperty('NODE_ENV')) {
        // Set NODE_ENV environment variable if `--production` flag is set.
        app.log(colors.yellow('🚢  setting "production" environment.'));
        process.env.NODE_ENV = 'production';
    }

    let profile = profiler.task('rollup');
    let task;
    try {
        let bundle = options.bundle;
        if (!bundle) {
            let config = await Rollup.detectConfig();
            bundle = new Rollup(
                Object.assign({
                    config,
                }, options)
            );
        }
        task = app.log(`bundling... ${colors.grey(`(${utils.relativeToCwd(bundle.options.input)})`)}`, true);
        await bundle.build();
        await bundle.write();
        if (app.options.profile) {
            let tasks = bundle.timings;
            for (let k in tasks) {
                profile.task(k, false).set(tasks[k]);
            }
        }
        profile.end();
        task();
        app.log(colors.bold(colors.green('bundle ready!')));
        let { size, zipped } = utils.size(bundle.options.output);
        app.log(`${utils.relativeToCwd(bundle.options.output)} ${colors.grey(`(${utils.prettyBytes(size)}, ${utils.prettyBytes(zipped)} zipped)`)}`);

        if (bundle.linter && (bundle.linter.hasErrors() || bundle.linter.hasWarnings())) {
            app.log(bundle.linter.report());
        }

        bundle.__fn = rollup;

        utils.gc();

        return bundle;
    } catch (err) {
        if (task) {
            task();
        }
        profile.end();
        throw err;
    }
}

async function postcss(app, options, profiler) {
    const PostCSS = require('../../lib/Bundlers/PostCSS.js');

    let profile = profiler.task('postcss');
    let task;
    try {
        let bundle = options.bundle;
        if (!bundle) {
            bundle = new PostCSS(options);
        }
        task = app.log(`postcss... ${colors.grey(`(${utils.relativeToCwd(bundle.options.input)})`)}`, true);
        await bundle.build();
        await bundle.write();
        task();
        profile.end();
        app.log(colors.bold(colors.green('css ready!')));
        let { size, zipped } = utils.size(bundle.options.output);
        app.log(`${utils.relativeToCwd(bundle.options.output)} ${colors.grey(`(${utils.prettyBytes(size)}, ${utils.prettyBytes(zipped)} zipped)`)}`);

        if (bundle.linter && (bundle.linter.hasErrors() || bundle.linter.hasWarnings())) {
            app.log(bundle.linter.report());
        }

        bundle.__fn = postcss;

        utils.gc();

        return bundle;
    } catch (err) {
        if (task) {
            task();
        }
        profile.end();
        throw err;
    }
}

function changedBundles(bundles, file) {
    return bundles
        .filter((bundle) => {
            let bundleFiles = bundle.files || [];
            return bundleFiles.includes(file);
        });
}

/**
 * Command action to build sources.
 *
 * @param {CLI} app CLI instance.
 * @param {Object} options Options.
 * @param {Profiler} profiler The command profiler instance.
 * @returns {Promise}
 *
 * @namespace options
 * @property {Boolean} production Should bundle files for production.
 * @property {Boolean} map Should include sourcemaps.
 * @property {Boolean} lint Should lint files before bundle.
 * @property {Boolean} lint-styles Should lint SASS files.
 * @property {Boolean} lint-js Should lint JavaScript files.
 * @property {Boolean} watch Should watch files.
 * @property {Boolean} cache Use cache if available.
 */
module.exports = async function build(app, options = {}, profiler) {
    const cwd = process.cwd();

    options = Proteins.clone(options);

    let entries = Entry.resolve(cwd, options.arguments);
    let bundles = [];

    // Process entries.
    for (let i = 0; i < entries.length; i++) {
        let entry = entries[i];

        if (entry.file) {
            let opts = Proteins.clone(options);
            opts.input = entry.file.path;
            if (opts.output) {
                if (entries.length > 1) {
                    opts.output = path.resolve(path.dirname(entry.file.path), opts.output);
                }
            }
            opts.targets = opts.targets ? browserslist.elaborate(opts.targets) : browserslist.load(opts.input);
            if (ext.isStyleFile(entry.file.path)) {
                // Style file
                let manifest = await postcss(app, opts, profiler);
                // collect the generated Bundle
                bundles.push(manifest);
                continue;
            }
            // Javascript file
            let manifest = await rollup(app, opts, profiler);
            // collect the generated Bundle
            bundles.push(manifest);
            continue;
        }

        let json = entry.package.json;

        // if package has not main field and options output is missing
        // the cli cannot detect where to build the files.
        if (!json.main && !options.output) {
            throw `Missing 'output' property for ${entry.package.name} module.`;
        }

        // build `modules` > `main`.js
        // clone options in order to use for js bundler.
        let jsOptions = Proteins.clone(options);
        if (json.module && ext.isJSFile(json.module)) {
            // if module field is a javascript file, use it as source file.
            jsOptions.input = path.join(entry.package.path, json.module);
            // if the output option is missing, use the main field.
            let stat = fs.existsSync(json.main) && fs.statSync(json.main);
            let distPath = stat && stat.isDirectory() ?
                path.join(entry.package.path, json.main, path.basename(jsOptions.input)) :
                path.join(entry.package.path, json.main);
            jsOptions.output = jsOptions.output || distPath;
        } else if (jsOptions.output && ext.isJSFile(json.main)) {
            // if output option is different from the main field
            // we can use the main file as source if it is javascript.
            jsOptions.input = path.join(entry.package.path, json.main);
        }
        if (jsOptions.input) {
            jsOptions.targets = options.targets ? browserslist.elaborate(options.targets) : browserslist.load(json);
            // a javascript source has been detected.
            let manifest = await rollup(app, jsOptions, profiler);
            bundles.push(manifest);
        }

        // build `style` > `main`.css
        // clone options in order to use for sass bundler.
        let styleOptions = Proteins.clone(options);
        if (json.style && ext.isStyleFile(json.style)) {
            // if style field is a style file, use it as source file.
            styleOptions.input = path.join(entry.package.path, json.style);
            // if the output option is missing, use the main field.
            let stat = fs.existsSync(json.main) && fs.statSync(json.main);
            let distPath = stat && stat.isDirectory() ?
                path.join(entry.package.path, json.main, path.basename(jsOptions.input)) :
                path.join(entry.package.path, json.main);
            styleOptions.output = styleOptions.output || distPath;
            // ensure output style file.
            if (!ext.isStyleFile(styleOptions.output)) {
                styleOptions.output = path.join(
                    path.dirname(styleOptions.output),
                    `${path.basename(styleOptions.output, path.extname(styleOptions.output))}.css`
                );
            }
        } else if (styleOptions.output && ext.isStyleFile(json.main)) {
            // if output option is different from the main field
            // we can use the main file as source if it is a style.
            styleOptions.input = path.join(entry.package.path, json.main);
        }
        if (styleOptions.input) {
            styleOptions.targets = options.targets ? browserslist.elaborate(options.targets) : browserslist.load(json);
            // a style source has been detected.
            let manifest = await postcss(app, styleOptions, profiler);
            // collect the generated Bundle
            bundles.push(manifest);
        }
    }

    // once bundles are generated, check for watch option.
    if (options.watch) {
        // setup a bundles priority chain.
        let queue = new PriorityQueues();
        // start the watch task
        let watcher = new Watcher(cwd, {
            log: true,
            ignore: (file) => !changedBundles(bundles, file).length,
        });

        watcher.watch(async (event, file) => {
            let promise = Promise.resolve();
            let bundlesWithChanges = changedBundles(bundles, file);

            if (bundlesWithChanges.length === 0) {
                return true;
            }

            let ticks = await Promise.all(
                // find out manifests with changed file dependency.
                bundlesWithChanges.map((bundle) => queue.tick(bundle, 100))
            );

            for (let i = 0; i < ticks.length; i++) {
                if (!ticks[i]) {
                    continue;
                }

                let bundle = bundlesWithChanges[i];
                promise = promise.then(async () => {
                    try {
                        await bundle.__fn(app, {
                            bundle,
                        }, profiler);
                    } catch (err) {
                        if (err) {
                            app.log(err);
                        }
                    }
                });
            }

            await promise;
        });
    }
    // resolve build task with the list of generated manifests.
    return bundles;
};
