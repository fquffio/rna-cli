const { Application } = require('typedoc');
const JSDocPlugin = require('./plugins/typedoc-plugin-jsdoc/typedoc-plugin-jsdoc');
const MonorepoPlugin = require('./plugins/typedoc-plugin-monorepo/typedoc-plugin-monorepo');
const DemoPlugin = require('./plugins/typedoc-plugin-demo/typedoc-plugin-demo');

class Documentator {
    static detectConfig(app, project, options = {}) {
        const configFile = app.store.tmpfile('tsdoc.json');
        configFile.writeJson({
            compilerOptions: {
                baseUrl: project.path,
                allowJs: true,
                module: 'es2016',
                target: 'es6',
                outDir: app.store.tmpdir('tsdoc').path,
                moduleResolution: 'node',
            },
        });

        return {
            out: options.output,
            mode: 'modules',
            theme: `${__dirname}/plugins/typedoc-template`,
            excludePrivate: true,
            excludeProtected: true,
            excludeExternals: true,
            externalPattern: 'node_modules',
            hideGenerator: true,
            ignoreCompilerErrors: true,
            tsconfig: configFile.path,
            name: options.name || project.get('name'),
            readme: project.file('README.md').path,
        };
    }

    constructor(options = {}) {
        this.options = Object.assign({}, options);
        this.app = new Application(options);
        this.app.converter.addComponent('jsdoc', JSDocPlugin);
        this.app.converter.addComponent('monorepo', MonorepoPlugin);
        this.app.converter.addComponent('demo', DemoPlugin);
    }

    async build(files = []) {
        this.app.generateDocs(files, this.options.out);
    }
}

module.exports = Documentator;
