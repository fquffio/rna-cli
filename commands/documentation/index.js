/**
 * Register command to CLI.
 *
 * @param {Command} program Command.
 * @returns {void}
 */
module.exports = (program) => {
    program
        .command('documentation')
        .readme(`${__dirname}/README.md`)
        .description('Generate API references.')
        .option('<file>', 'The files to documentate.')
        .option('--name', 'The documentation name.')
        .option('--output', 'The documentation output directory.')
        .action(async (app, options) => {
            const Project = require('../../lib/Project');
            const Documentator = require('../../lib/Documentator/Documentator');

            if (!options.output) {
                throw 'Missing \'output\' property.';
            }

            const cwd = process.cwd();
            const project = new Project(cwd);

            const doc = new Documentator(Documentator.detectConfig(app, project, options));

            let entries;
            if (options.arguments.length) {
                entries = project.resolve(options.arguments);
            } else {
                // use cwd sources.
                const workspaces = project.workspaces;
                if (workspaces) {
                    entries = workspaces;
                } else {
                    entries = [project];
                }
            }

            let files = [];

            entries.forEach((entry) => {
                if (!entry.exists()) {
                    return;
                }
                if (entry instanceof Project) {
                    let src = [
                        entry.directories.src,
                        entry.directory('src'),
                    ].find((dir) => dir && dir.exists());
                    if (src) {
                        files.push(
                            ...src
                                .resolve('**/*.{ts,js,mjs}')
                                .map((file) => file.path)
                        );
                    }
                    return;
                }
                files.push(entry.path);
            });

            if (!files.length) {
                throw 'missing files for documentation';
            }

            await doc.build(files);
        });
};
