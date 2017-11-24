const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');
const rollup = require('rollup');
const RollupTimer = require('rollup-timer').RollupTimer;
const paths = require('../../../lib/paths.js');
const importer = require('../../../lib/import.js');
const utils = require('../../../lib/utils.js');
const BundleManifest = require('../../../lib/bundle.js');
const isCore = require('resolve').isCore;

const babel = require('../plugins/rollup-plugin-babel/rollup-plugin-babel.js');
const resolve = require('rollup-plugin-node-resolve');
const common = require('rollup-plugin-commonjs');
const sass = require('rollup-plugin-sass-modules');
const uglify = require('rollup-plugin-uglify');
const json = require('rollup-plugin-json');
const url = require('rollup-plugin-url');
const jsx = require('rollup-plugin-external-jsx');
const string = require('rollup-plugin-string');

const postcss = require('postcss');
const autoprefixer = require('autoprefixer');

const caches = {};

function getPostCssConfig() {
    let localConf = path.join(paths.cwd, 'postcss.json');
    if (fs.existsSync(localConf)) {
        return require(localConf);
    }
    return {
        browsers: ['last 3 versions'],
    };
}

function getBabelConfig(options) {
    let localConf = path.join(paths.cwd, '.babelrc');
    if (fs.existsSync(localConf)) {
        return JSON.parse(fs.readFileSync(localConf), 'utf8');
    }
    return {
        include: '**/*.{mjs,js,jsx}',
        exclude: [],
        compact: false,
        presets: options.transpile !== false ? [
            [require('@babel/preset-env'), {
                targets: {
                    browsers: ['ie >= 11', 'safari >= 8'],
                },
                modules: false,
            }],
        ] : undefined,
        plugins: [
            [require('@babel/plugin-transform-template-literals'), {
                loose: true,
            }],
            [require('@babel/plugin-transform-react-jsx'), {
                pragma: 'IDOM.h',
            }],
            require('babel-plugin-transform-inline-environment-variables'),
        ],
    };
}

function getConfig(app, options) {
    let localConf = path.join(paths.cwd, 'rollup.config.js');
    if (fs.existsSync(localConf)) {
        return importer(localConf)
            .then((conf) => {
                if (!conf.input) {
                    conf.input = options.input;
                }
                app.log(colors.grey(`Config file: ${localConf}`));
                return conf;
            });
    }
    if (!options.output) {
        app.log(colors.red(`Missing 'output' option for ${options.input}.`));
        return global.Promise.reject();
    }
    const babelConfig = getBabelConfig(options);
    return global.Promise.resolve({
        name: options.name,
        input: options.input,
        file: options.output,
        sourcemap: options.map !== false,
        format: 'umd',
        strict: false,
        // https://github.com/rollup/rollup/issues/1626
        cache: options.cache ? caches[options.input] : undefined,
        indent: false,
        plugins: [
            resolve(),
            json(),
            string({
                include: [
                    '**/*.{html,txt,svg,md}',
                ],
            }),
            url({
                limit: 10 * 1000 * 1024,
                exclude: [],
                include: [
                    '**/*.{woff,ttf,eot,gif,png,jpg}',
                ],
            }),
            sass({
                processor: (css) =>
                    postcss(
                        [
                            autoprefixer(getPostCssConfig()),
                        ]
                    ).process(css).then(result => result.css),
                exclude: [],
                include: [
                    '**/*.{css,scss,sass}',
                ],
                options: {
                    outFile: options['external-css'] && path.join(
                        path.dirname(options.output),
                        `${path.basename(options.output, path.extname(options.output))}.css`
                    ),
                    sourceMap: options.map !== false,
                    sourceMapEmbed: options.map !== false,
                },
            }),
            jsx({
                // Required to be specified
                include: '**/*.jsx',
                // import header
                header: 'import { IDOM } from \'@dnajs/idom\';',
            }),
            babel(babelConfig),
            common({
                ignore: (id) => isCore(id),
            }),
            options.production ? uglify({
                output: {
                    comments: /@license/,
                },
            }) : {},
        ],
        onwarn(message) {
            const whitelisted = () => {
                message = message.toString();
                if (message.indexOf('The \'this\' keyword') !== -1) {
                    return false;
                }
                if (message.indexOf('It\'s strongly recommended that you use the "external-helpers" plugin') !== -1) {
                    return false;
                }
                if (message.indexOf('commonjs-proxy:rollupPluginBabelHelper') !== -1) {
                    return false;
                }
                return true;
            };
            if (message && options.verbose || whitelisted()) {
                app.log(colors.yellow(`⚠️  ${message}`));
            }
        },
    });
}

function timeReport(profiler, timer) {
    let timings = timer._timings || {};
    for (let k in timings) {
        let data = timings[k];
        if (data.length) {
            let sum = 0;
            data.forEach((t) => sum += t);
            profiler.task(k, false).set(sum);
        }
    }
}

module.exports = (app, options) => {
    if (options.output) {
        options.output = path.resolve(paths.cwd, options.output);
        let final = options.output.split(path.sep).pop();
        if (!final.match(/\./)) {
            options.output = path.join(
                options.output,
                path.basename(options.input)
            );
        }
    }
    if (!options.name) {
        options.name = utils.camelize(
            path.basename(options.output, path.extname(options.output))
        );
    }
    if (options.transpile === false) {
        app.log(colors.yellow('⚠️ skipping Babel task.'));
    }
    if (options.production && !process.env.hasOwnProperty('NODE_ENV')) {
        // Set NODE_ENV environment variable if `--production` flag is set.
        app.log(colors.yellow('🚢 setting "production" environment.'));
        process.env.NODE_ENV = 'production';
    }
    let profiler = app.profiler.task('rollup');
    let task = app.log(`bundling${caches[options.input] ? ' [this will be fast]' : ''}... ${colors.grey(`(${options.input})`)}`, true);
    return getConfig(app, options)
        .then((config) => {
            const timer = new RollupTimer();
            if (app.options.profile) {
                config.plugins = timer.time(config.plugins);
            }
            return rollup.rollup(config)
                .then((bundler) => {
                    options.output = options.output || config.output;
                    caches[options.input] = bundler;
                    return bundler.write(config)
                        .then(() => {
                            timeReport(profiler, timer);
                            app.profiler.endTask('rollup');
                            task();
                            app.log(`${colors.bold(colors.green('bundle ready!'))} ${colors.grey(`(${options.output})`)}`);
                            let manifest = new BundleManifest(options.input, options.output);
                            // get bundle dependencies
                            bundler.modules.forEach((mod) => {
                                let dependencies = mod.dependencies || [];
                                // filter files
                                dependencies = dependencies.filter((p) => fs.existsSync(p));
                                // map to real files
                                dependencies = dependencies.map((p) => fs.realpathSync(p));
                                // add to manifest
                                manifest.addFile(...dependencies);
                            });
                            return global.Promise.resolve(manifest);
                        });
                });
        })
        .catch((err) => {
            task();
            if (err) {
                app.log(err);
            }
            app.log(colors.red(`error bundling ${options.name}`));
            return global.Promise.reject();
        });
};
