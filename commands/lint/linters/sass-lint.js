const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');
const glob = require('glob');
const SassLinter = require('sass-lint');

/**
 * Run SASS Lint.
 *
 * @param {CLI} app The current CLI instance.
 * @param {object} options A set of options for the linter.
 * @param {string|Array<string>} files Glob string or array of files to lint.
 *
 * @namespace options
 * @property {Boolean} warnings Should include warnings in the response.
 */
module.exports = function sasslintTask(app, options, profiler) {
    let sassFiles = [];
    options.files
        .filter((src) => fs.existsSync(src))
        .filter((src) => !fs.statSync(src).isFile() || src.match(/\.(css|sass|scss)$/i))
        .forEach((src) => {
            if (fs.statSync(src).isFile()) {
                // Physical file.
                sassFiles.push(src);
            } else {
                // Workspace.
                sassFiles.push(...glob.sync(
                    path.join(src, 'src/**/*.{scss,sass,css}')
                ));
            }
        });
    if (sassFiles.length) {
        let profile = profiler.task('sass-lint');
        let task = app.log('running SassLint...', true);
        try {
            let reports = [];
            sassFiles.forEach((src) => {
                let report = SassLinter.lintFiles(src, {});
                report.forEach((r) => {
                    if (r.errorCount) {
                        reports.push(r);
                    } else if (r.warningCount && options.warnings !== false) {
                        reports.push(r);
                    }
                });
            });
            profile.end();
            task(); // Stop loader.
            if (reports.length) {
                SassLinter.outputResults(reports);
                return global.Promise.resolve(reports);
            }
            app.log('everything is fine with SassLint.');
        } catch (err) {
            profile.end();
            task();
            app.log(colors.red('failed to execute SassLint.'));
            return global.Promise.reject(err);
        }
    }
    return global.Promise.resolve();
};
