/**
 * Register command to CLI.
 *
 * @param {Command} program Command.
 * @returns {void}
 */
module.exports = (program) => {
    program
        .command('cdn')
        .description('Upload files on CDN.')
        .action((app, options = {}) => require('./action')(app, options));
};
