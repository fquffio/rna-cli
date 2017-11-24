/**
 * Register command to CLI.
 *
 * @param {Command} program Command.
 * @returns {void}
 */
module.exports = (program) => {
    program
        .command('wiki')
        .description('Generate project wiki frontend.')
        .option('[<path>]', 'The path of the project.')
        .option('--pages', 'The path to markdown files.')
        .option('--output', 'Where to build the wiki.')
        .option('--logo', 'A logo path.')
        .action((app, options = {}) => {
            try {
                return require('./action')(app, options);
            } catch (err) {
                return global.Promise.reject(err);
            }
        });
};
