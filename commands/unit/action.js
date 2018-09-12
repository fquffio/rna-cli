const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');
const Proteins = require('@chialab/proteins');
const karma = require('karma');
const Mocha = require('mocha');
const paths = require('../../lib/paths.js');
const saucelabs = require('../../lib/saucelabs.js');
const Entry = require('../../lib/entry.js');
const browserslist = require('../../lib/browserslist.js');
const runNativeScriptTest = require('./lib/ns.js');

/**
 * A list of available environments.
 * @type {Object}
 */
const ENVIRONMENTS = {
    node: { runner: 'mocha' },
    browser: { runner: 'karma' },
    saucelabs: { runner: 'karma' },
    electron: { runner: 'karma' },
    nativescript: { runner: 'ns' },
};

/**
 * Get Karma configuration.
 *
 * @param {CLI} app CLI.
 * @param {Object} options Options.
 * @returns {string|Object}
 */
function getConfig(app, options) {
    let localConf = path.join(paths.cwd, 'karma.conf.js');
    if (fs.existsSync(localConf)) {
        // Local Karma config exists. Use that.
        return localConf;
    }
    let entry = Entry.resolve(paths.cwd, paths.cwd)[0];

    let conf = {
        // base path that will be used to resolve all patterns (eg. files, exclude)
        basePath: paths.cwd,

        // frameworks to use
        // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
        frameworks: ['mocha', 'chai'],

        // mocha timeout option if given
        client: {
            mocha: {
                timeout: options.timeout && Proteins.isNumber(Number(options.timeout)) ? options.timeout : 2000,
            },
        },

        // test results reporter to use
        // possible values: 'dots', 'progress'
        // available reporters: https://npmjs.org/browse/keyword/karma-reporter
        reporters: [
            options.ci ? 'dots' : 'mocha',
        ],

        // web server port
        port: 9876,

        // browser's timeout for handling Safari issues
        browserDisconnectTimeout: 6 * 1000,
        browserDisconnectTolerance: 5,
        browserNoActivityTimeout: 2 * 60 * 1000,
        captureTimeout: 2 * 60 * 1000,

        // enable / disable colors in the output (reporters and logs)
        colors: true,

        // level of logging
        // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
        logLevel: 'INFO',

        // enable / disable watching file and executing tests whenever any file changes
        autoWatch: !!options.server,

        // start these browsers
        // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
        browsers: [],

        // customContextFile if any
        customContextFile: options.customContextFile ? options.customContextFile : null,

        plugins: [
            require('karma-sourcemap-loader'),
            require('karma-mocha'),
            require('karma-mocha-reporter'),
            require('./plugins/karma-chai/index.js'),
        ],

        // Continuous Integration mode
        // if true, Karma captures browsers, runs the tests and exits
        singleRun: !options.server,

        // Concurrency level
        // how many browser should be started simultaneously
        concurrency: options.concurrency && Proteins.isNumber(Number(options.concurrency)) ? options.concurrency : 2,
    };

    if (!options.server) {
        if (options.browser) {
            conf.frameworks.push('detectBrowsers');
            // list of browsers with launcher.
            const launchers = ['chrome', 'firefox', 'ie', 'edge', 'safari', 'opera'];
            launchers.forEach((launcherName) => {
                // add the launcher plugin for each browser.
                conf.plugins.push(
                    require(`karma-${launcherName}-launcher`)
                );
            });
            conf.plugins.push(
                require('karma-detect-browsers')
            );
            conf.customLaunchers = {
                Chrome_CI: {
                    base: 'Chrome',
                    flags: ['--no-sandbox'],
                },
            };

            conf.detectBrowsers = {
                usePhantomJS: false,
                postDetection: (availableBrowser) => {
                    // remove available browsers without a launcher.
                    availableBrowser = availableBrowser.filter((browserName) => launchers.indexOf(browserName.toLowerCase()) !== -1);
                    // we are replacing the detected `Chrome` with the `Chrome_CI` configuration.
                    const ioChrome = availableBrowser.indexOf('Chrome');
                    if (ioChrome !== -1) {
                        availableBrowser.splice(ioChrome, 1, 'Chrome_CI');
                    }
                    return availableBrowser;
                },
            };
        }

        if (options.saucelabs) {
            // SauceLabs configuration.
            conf.retryLimit = 3;
            conf.reporters.push('saucelabs');
            conf.sauceLabs = {
                startConnect: true,
                connectOptions: {
                    'no-ssl-bump-domains': 'all',
                },
                options: {},
                username: process.env.SAUCE_USERNAME,
                accessKey: process.env.SAUCE_ACCESS_KEY,
                build: process.env.TRAVIS ? `TRAVIS # ${process.env.TRAVIS_BUILD_NUMBER} (${process.env.TRAVIS_BUILD_ID})` : `RNA-${Date.now()}`,
                tunnelIdentifier: process.env.TRAVIS ? process.env.TRAVIS_JOB_NUMBER : undefined,
                recordScreenshots: true,
            };
            if (entry && entry.package) {
                conf.sauceLabs.testName = saucelabs.getTestName(paths.cwd, entry.package.name, 'Unit');
            }
            let saucelabsBrowsers = saucelabs.launchers(options.targets ? browserslist.elaborate(options.targets) : browserslist.load(paths.cwd));
            conf.customLaunchers = saucelabsBrowsers;
            conf.browsers = Object.keys(saucelabsBrowsers);
            if (conf.browsers.length === 0) {
                throw new Error('invalid SauceLabs targets.');
            }
            conf.plugins.push(require('karma-sauce-launcher'));
        }

        if (options.electron) {
            // Test on Electron.
            conf.browsers = ['Electron'];
            conf.plugins.push(require('./plugins/karma-electron-launcher/index.js'));
        }
    }

    if (options.ci) {
        // Optimal configuration for CI environment.
        conf.client = conf.client || {};
        conf.client.captureConsole = false;
        conf.logLevel = 'ERROR';
    }

    if (options.coverage) {
        // Collect code coverage.
        conf.plugins.push('karma-coverage');
        conf.coverageReporter = {
            dir: 'reports/unit/coverage',
            reporters: [
                {
                    type: 'in-memory',
                },
                {
                    type: 'lcov',
                    subdir: (browserName) => path.join('report-lcov', browserName),
                },
            ],
        };
        conf.reporters.push('coverage');
    }

    return conf;
}

/**
 * Command action to run tests.
 *
 * @param {CLI} app CLI instance.
 * @param {Object} options Options.
 * @returns {Promise}
 */
module.exports = async(app, options = {}) => {
    if (!paths.cwd) {
        // Unable to detect project root.
        throw 'No project found.';
    }

    // check sauce values
    if (options.saucelabs) {
        if (options['saucelabs.username']) {
            process.env.SAUCE_USERNAME = options['saucelabs.username'];
        }
        if (options['saucelabs.key']) {
            process.env.SAUCE_ACCESS_KEY = options['saucelabs.key'];
        }
        if (!process.env.SAUCE_USERNAME) {
            throw 'Missing SAUCE_USERNAME variable.';
        }
        if (!process.env.SAUCE_ACCESS_KEY) {
            throw 'Missing SAUCE_ACCESS_KEY variable.';
        }
    }

    // Handle Karma custom context file option
    const customContextFile = options['context'];

    if (!process.env.hasOwnProperty('NODE_ENV')) {
        // Set NODE_ENV environment variable.
        app.log(colors.yellow('🔍 setting "test" environment.'));
        process.env.NODE_ENV = 'test';
    }

    // Load options.
    options = Proteins.clone(options);
    options.ci = options.hasOwnProperty('ci') ? options.ci : process.env.CI; // Is this CI environment?

    // Load list of files to be tested.
    let files = [];
    let entries = Entry.resolve(paths.cwd, options.arguments);
    entries.forEach((entry) => {
        if (entry.file) {
            // process file
            if (fs.statSync(entry.file.path).isDirectory()) {
                files.push(...Entry.resolve(paths.cwd, path.join(entry.file.path, 'test/unit/**/*.js')));
            } else {
                files.push(entry);
            }
        } else {
            // process package
            files.push(...Entry.resolve(paths.cwd, path.join(entry.package.path, 'test/unit/**/*.js')));
        }
    });

    if (!files.length) {
        app.log(colors.yellow('no unit tests found.'));
        return;
    }

    let taskEnvironments = Object.keys(options).filter((optName) => options[optName] && optName in ENVIRONMENTS);
    if (!taskEnvironments.length) {
        // If test environment is not provide, use `browser` as default.
        taskEnvironments.push('browser');
    }

    // build tests
    let tempSource = path.join(paths.tmp, `source-${Date.now()}.js`);
    let tempUnit = path.join(paths.tmp, `unit-${Date.now()}.js`);
    const unitCode = `${files.map((entry) => `import '${entry.file.path}';`).join('\n')}`;
    fs.writeFileSync(tempSource, unitCode);
    await app.exec('build', { // Build sources.
        'arguments': [tempSource],
        'coverage': options.coverage,
        'output': tempUnit,
        'targets': options.targets,
        'map': 'inline',
        'jsx.pragma': options['jsx.pragma'],
        'jsx.module': options['jsx.module'],
    });

    // Test built sources.
    for (let i = 0; i < taskEnvironments.length; i++) {
        let taskEnvName = taskEnvironments[i];
        let taskEnv = ENVIRONMENTS[taskEnvName];
        if (taskEnv.runner === 'mocha') {
            // Startup Mocha.
            require('source-map-support/register');
            const mocha = new Mocha();
            mocha.addFile(tempUnit);
            await new Promise((resolve, reject) => {
                mocha.run((failures) => {
                    if (failures) {
                        reject(failures);
                    } else {
                        resolve();
                    }
                });
            });
            continue;
        }

        if (taskEnv.runner === 'karma') {
            // Startup Karma.
            let karmaOptions = getConfig(app, {
                ci: options.ci,
                server: options.server,
                coverage: options.coverage,
                targets: options.targets,
                concurrency: options.concurrency,
                timeout: options.timeout,
                customContextFile,
                [taskEnvName]: true,
            });
            karmaOptions.files = [tempUnit];
            karmaOptions.preprocessors = {
                [tempUnit]: ['sourcemap'],
            };
            let server = await new Promise((resolve, reject) => {
                let s = new karma.Server(karmaOptions, (exitCode) => {
                    if (exitCode && !options.server) {
                        reject();
                    } else {
                        resolve(s);
                    }
                });
            });
            if (!options.server) {
                server.on('listening', (port) => {
                    let browsers = server.get('config').browsers;
                    if (!browsers || browsers.length === 0) {
                        karma.stopper.stop({ port });
                    }
                });
            }
            if (options.coverage) {
                let reportMap;
                server.on('run_start', () => {
                    reportMap = require('istanbul-lib-coverage').createCoverageMap({});
                });
                server.on('coverage_complete', (browser, coverageReport) => {
                    reportMap.merge(coverageReport);
                });
                server.on('run_complete', () => {
                    setTimeout(() => {
                        reportMap = reportMap.toJSON();
                        let coverageFiles = Object.keys(reportMap);
                        if (coverageFiles.length) {
                            const utils = require('istanbul/lib/object-utils');
                            let summaries = coverageFiles.map((coverageFile) => utils.summarizeFileCoverage(reportMap[coverageFile]));
                            let finalSummary = utils.mergeSummaryObjects.apply(null, summaries);
                            app.log(colors.bold(colors.underline('COVERAGE SUMMARY:')));
                            app.log(formatCoverageReport(finalSummary, 'statements'));
                            app.log(formatCoverageReport(finalSummary, 'branches'));
                            app.log(formatCoverageReport(finalSummary, 'functions'));
                            app.log(formatCoverageReport(finalSummary, 'lines'));
                        }
                    });
                });
            }
            server.start();
            continue;
        }

        if (taskEnv.runner === 'ns') {
            if (!['ios', 'android'].includes(options.nativescript.toLowerCase())) {
                throw 'Invalid nativescript platform. Valid platforms are `ios` and `android`.';
            }
            // Create fake NS application.
            await runNativeScriptTest(options.nativescript, tempUnit);
        }
    }
};

/**
 * Format coverage report metrics.
 * @param {Object} summary The full file coverage report.
 * @param {String} key The metric name.
 * @return {String}
 */
function formatCoverageReport(summary, key) {
    let metrics = summary[key];
    let skipped;
    let result;
    // Capitalize the field name
    let field = key.substring(0, 1).toUpperCase() + key.substring(1);
    if (field.length < 12) {
        // add extra spaces after the field name
        field += '                   '.substring(0, 12 - field.length);
    }
    result = `${field} : ${metrics.pct}% (${metrics.covered}/${metrics.total})`;
    skipped = metrics.skipped;
    if (skipped > 0) {
        result += `, ${skipped} ignored`;
    }
    let color = (metrics.pct >= 80 && 'green') ||
        (metrics.pct >= 50 && 'yellow') ||
        'red';
    return colors[color](result);
}
