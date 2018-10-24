/**
 * Register command to CLI.
 *
 * @param {Command} program Command.
 * @returns {void}
 */
module.exports = (program) => {
    program
        .command('unit')
        .description('Run project unit tests.')
        .readme(`${__dirname}/README.md`)
        .option('[--targets]', 'A supported browserslist query.')
        .option('[--node]', 'Run tests in node context.')
        .option('[--browser]', 'Run tests in browser context.')
        .option('[--saucelabs]', 'Use SauceLabs as browsers provider.')
        .option('[--saucelabs.username]', 'SauceLabs username.')
        .option('[--saucelabs.key]', 'SauceLabs access key.')
        .option('[--browserstack]', 'Use Browserstack as browsers provider.')
        .option('[--electron]', 'Use electron.')
        .option('[--nativescript <ios|android>]', 'Use nativescript.')
        .option('[--coverage]', 'Enable code coverage.')
        .option('[--ci]', 'Run in continuous integration mode.')
        .option('[--concurrency]', 'Concurrency level for Karma.')
        .option('[--context]', 'Use specified file as Karma custom context file for polyfill script.')
        .option('[--timeout]', 'Mocha timeout for a single test. Defaults to 2000 (ms).')
        .option('[--watch]', 'Watch test files.')
        .action(async (app, options = {}) => {
            const Proteins = require('@chialab/proteins');
            const karma = require('karma');
            const Mocha = require('mocha');
            const browserslist = require('browserslist');
            const Project = require('../../lib/Project');
            const Rollup = require('../../lib/Bundlers/Rollup');
            const Watcher = require('../../lib/Watcher');
            const runNativeScriptTest = require('./lib/ns');

            const cwd = process.cwd();
            const project = new Project(cwd);

            const targets = browserslist(options.targets || project.browserslist);

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

            if (options.browserstack) {
                if (options['browserstack.username']) {
                    process.env.BROWSER_STACK_USERNAME = options['browserstack.username'];
                }
                if (options['browserstack.key']) {
                    process.env.BROWSER_STACK_ACCESS_KEY = options['browserstack.key'];
                }
                if (!process.env.BROWSER_STACK_USERNAME) {
                    throw 'Missing BROWSERSTACK_USERNAME variable.';
                }
                if (!process.env.BROWSER_STACK_ACCESS_KEY) {
                    throw 'Missing BROWSERSTACK_ACCESS_KEY variable.';
                }
            }

            if (!process.env.hasOwnProperty('NODE_ENV')) {
                // Set NODE_ENV environment variable.
                app.logger.info('setting "test" environment');
                process.env.NODE_ENV = 'test';
            }

            // Load options.
            options = Proteins.clone(options);
            options.ci = options.hasOwnProperty('ci') ? options.ci : process.env.CI; // Is this CI environment?

            // Load list of files to be tested.
            let files = [];

            if (options.arguments.length) {
                files = project.resolve(options.arguments);
            } else {
                let testDirs = [];
                let workspaces = project.workspaces;
                if (workspaces) {
                    workspaces.forEach((entry) => {
                        let testDir = entry.directories.test;
                        if (!testDir) {
                            testDir = entry.directory('test');
                        }
                        testDirs.push(testDir);
                    });
                } else {
                    let testDir = project.directories.test;
                    if (!testDir) {
                        testDir = project.directory('test');
                    }
                    testDirs.push(testDir);
                }
                files = testDirs
                    .reduce((list, directory) => {
                        list.push(...directory.resolve('**/*.js'));
                        return list;
                    }, []);
            }

            if (!files.length) {
                app.logger.warn('no unit tests found.');
                return;
            }

            let taskEnvironments = Object.keys(options).filter((optName) => options[optName] && optName in ENVIRONMENTS);
            if (!taskEnvironments.length) {
                // If test environment is not provide, use `browser` as default.
                taskEnvironments.push('browser');
            }

            const unitCode = `${files.map((entry) => `import '${entry.path}';`).join('\n')}`;

            // build tests
            const tempSource = app.store.tmpfile('unit-source.js');
            const tempUnit = app.store.tmpfile('unit-build.js');
            tempSource.write(unitCode);

            let rebuild;
            let watchFiles;
            try {
                const config = Rollup.detectConfig(app, project, {
                    'input': tempSource.path,
                    'output': tempUnit.path,
                    'map': 'inline',
                    'coverage': options.coverage,
                    targets,
                    'jsx.pragma': options['jsx.pragma'],
                    'jsx.module': options['jsx.module'],
                });

                rebuild = async function() {
                    app.logger.play('bundling test...', tempSource.localPath);
                    const rollupBundle = new Rollup(config);
                    await rollupBundle.build();
                    await rollupBundle.write();
                    watchFiles = rollupBundle.files;
                    app.logger.stop();
                };

                await rebuild();
            } catch (error) {
                app.logger.stop();
                throw error;
            }

            app.logger.stop();

            // Test built sources.
            for (let i = 0; i < taskEnvironments.length; i++) {
                let taskEnvName = taskEnvironments[i];
                let taskEnv = ENVIRONMENTS[taskEnvName];

                if (taskEnv.runner === 'mocha') {
                    // Startup Mocha.
                    require('source-map-support/register');
                    const mocha = new Mocha();
                    mocha.addFile(tempUnit.path);
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

                    // Handle Karma custom context file option
                    let customContextFile;
                    if (options['context']) {
                        let original = project.file(options['context']);
                        customContextFile = tempUnit.directory.file(original.basename);
                        customContextFile.write(original.read());
                    }

                    const karmaOptions = await getConfig(app, project, {
                        ci: options.ci,
                        basePath: tempUnit.dirname,
                        watch: options.watch,
                        coverage: options.coverage,
                        targets,
                        concurrency: options.concurrency || (options.watch ? Infinity : undefined),
                        timeout: options.timeout,
                        customContextFile: customContextFile ? customContextFile.basename : undefined,
                        [taskEnvName]: true,
                    });
                    karmaOptions.middleware = karmaOptions.middleware || [];
                    karmaOptions.middleware.push('base');
                    karmaOptions.plugins = karmaOptions.plugins || [];
                    karmaOptions.plugins.push({
                        'middleware:base': ['factory', function base() {
                            return function(request, response, next) {
                                if (request.url.startsWith('/base/')) {
                                    return next();
                                }
                                response.writeHead(302, {
                                    Location: `/base${request.url}`,
                                });
                                response.end();
                            };
                        }],
                    });
                    karmaOptions.files = [
                        {
                            pattern: tempUnit.basename,
                            included: true,
                            served: true,
                            nocache: true,
                            watched: true,
                        },
                        {
                            pattern: '**/*',
                            included: false,
                            served: true,
                            nocache: false,
                            watched: false,
                        },
                    ];
                    karmaOptions.preprocessors = karmaOptions.preprocessors || {};
                    karmaOptions.preprocessors[tempUnit.path] = ['sourcemap'];

                    const server = new karma.Server(karmaOptions);

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
                                    app.logger.info('COVERAGE SUMMARY:');
                                    let statementsReport = formatCoverageReport(finalSummary, 'statements');
                                    app.logger[statementsReport.type](statementsReport.message);
                                    let branchesReport = formatCoverageReport(finalSummary, 'branches');
                                    app.logger[branchesReport.type](branchesReport.message);
                                    let functionsReport = formatCoverageReport(finalSummary, 'functions');
                                    app.logger[functionsReport.type](functionsReport.message);
                                    let linesReport = formatCoverageReport(finalSummary, 'lines');
                                    app.logger[linesReport.type](linesReport.message);
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
                    await runNativeScriptTest(app, options.nativescript, tempUnit.path);
                }
            }

            if (options.watch) {
                // start the watch task
                let watcher = new Watcher(project, {
                    ignore: (file) => watchFiles.includes(file.path),
                });

                await watcher.watch(async () => {
                    await rebuild();
                });
            }
        });
};


/**
 * A list of available environments.
 * @type {Object}
 */
const ENVIRONMENTS = {
    node: { runner: 'mocha' },
    browser: { runner: 'karma' },
    browserstack: { runner: 'karma' },
    saucelabs: { runner: 'karma' },
    electron: { runner: 'karma' },
    nativescript: { runner: 'ns' },
};

/**
 * Get Karma configuration.
 *
 * @param {CLI} app CLI.
 * @param {Project} project The current project.
 * @param {Object} options Options.
 * @returns {Promise<string|Object>}
 */
async function getConfig(app, project, options) {
    const localConf = project.file('karma.conf.js');
    if (localConf.exists()) {
        // Local Karma config exists. Use that.
        return localConf;
    }

    const conf = {
        // base path that will be used to resolve all patterns (eg. files, exclude)
        basePath: options.basePath || project.path,

        // frameworks to use
        // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
        frameworks: ['mocha', 'chai'],

        // mocha timeout option if given
        client: {
            mocha: {
                timeout: !isNaN(options.timeout) ? options.timeout : 2000,
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
        autoWatch: !!options.watch,

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
        singleRun: !options.watch,

        // Concurrency level
        // how many browser should be started simultaneously
        concurrency: !isNaN(options.concurrency) ? options.concurrency : 2,
    };

    if (options.browser) {
        const launchers = ['chrome', 'firefox', 'ie', 'edge', 'opera', 'safari'];

        conf.frameworks.push('detectBrowsers');
        conf.plugins.push(
            require('karma-chrome-launcher'),
            require('karma-firefox-launcher'),
            require('karma-ie-launcher'),
            require('karma-edge-launcher'),
            require('karma-opera-launcher'),
            require('./plugins/karma-safari-launcher/karma-safari-launcher'),
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
        const saucelabs = require('../../lib/saucelabs');

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

        conf.sauceLabs.testName = getTestName(project);

        let saucelabsBrowsers = await saucelabs.launchers(options.targets);
        conf.customLaunchers = saucelabsBrowsers;
        conf.browsers = Object.keys(saucelabsBrowsers);
        if (conf.browsers.length === 0) {
            throw new Error('invalid SauceLabs targets.');
        }
        conf.plugins.push(require('karma-sauce-launcher'));
    }

    if (options.browserstack) {
        const browserstack = require('../../lib/browserstack');

        conf.reporters.push('BrowserStack');
        conf.browserStack = {
            username: process.env.BROWSER_STACK_USERNAME,
            accessKey: process.env.BROWSER_STACK_ACCESS_KEY,
            startTunnel: true,
            retryLimit: 3,
            timeout: 1800,
            name: getTestName(project),
        };
        let browserstackBrowsers = await browserstack.launchers(options.targets);
        conf.customLaunchers = browserstackBrowsers;
        conf.browsers = Object.keys(browserstackBrowsers);
        if (conf.browsers.length === 0) {
            throw new Error('invalid BrowserStack targets.');
        }
        conf.plugins.push(require('karma-browserstack-launcher'));
    }

    if (options.electron) {
        // Test on Electron.
        conf.browsers = ['ElectronBrowser'];
        conf.customLaunchers = {
            ElectronBrowser: {
                base: 'Electron',
                tmpdir: app.store.tmpdir('ElectronTest').path,
            },
        };
        conf.plugins.push(require('./plugins/karma-electron-launcher/index.js'));
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
            dir: project.directory('reports/coverage').path,
            reporters: [
                {
                    type: 'in-memory',
                },
                {
                    type: 'lcov',
                    subdir: (browserName) => `report-lcov/${browserName}`,
                },
            ],
        };
        conf.reporters.push('coverage');
    }

    return conf;
}

/**
 * Format coverage report metrics.
 * @param {Object} summary The full file coverage report.
 * @param {String} key The metric name.
 * @return {String}
 */
function formatCoverageReport(summary, key) {
    let metrics = summary[key];
    let skipped;
    let message;
    // Capitalize the field name
    let field = key.substring(0, 1).toUpperCase() + key.substring(1);
    if (field.length < 12) {
        // add extra spaces after the field name
        field += '                   '.substring(0, 12 - field.length);
    }
    message = `${field} : ${metrics.pct}% (${metrics.covered}/${metrics.total})`;
    skipped = metrics.skipped;
    if (skipped > 0) {
        message += `, ${skipped} ignored`;
    }
    let type = (metrics.pct >= 80 && 'success') ||
        (metrics.pct >= 50 && 'warn') ||
        'error';
    return {
        type,
        message,
    };
}

/**
 * Create a Test name using git status.
 * @param {Project} project The project to test.
 * @return {String}
 */
function getTestName(project) {
    const Git = require('../../lib/Git.js');

    let message = `Tests for ${project.get('name')}`;
    const gitClient = new Git(project.path);

    const branchName = gitClient.getBranchName();
    const commit = gitClient.getShortCommitCode();
    const commitMessage = gitClient.getCommitMessage();

    if (branchName) {
        message = `${message} | ${branchName.trim()}`;
    }

    if (commit) {
        message = `${message}, ${commit.trim()}`;
    }

    if (commitMessage) {
        message = `${message}: '${commitMessage.trim().replace(/^['"]*/, '').replace(/['"]*$/, '')}'`;
    }

    return message;
}
