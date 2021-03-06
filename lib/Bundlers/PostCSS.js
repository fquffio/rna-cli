const fs = require('fs-extra');
const path = require('path');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const unset = require('postcss-all-unset');
const cssnano = require('cssnano');
const focusVisible = require('postcss-focus-visible');
const focusWithin = require('postcss-focus-within');
const StyleLint = require('../Linters/Stylelint');
const stylelintPlugin = require('./plugins/postcss-stylelint-plugin/postcss-stylelint-plugin.js');
const sass = require('./plugins/postcss-dart-sass/postcss-dart-sass.js');

class PostCSS {
    /**
     * Resolve the PostCSS configuration.
     *
     * @param {CLI} app The current app instance.
     * @param {Project} project The project to build.
     * @param {Object} options Default options.
     * @returns {Object}
     */
    static detectConfig(app, project, options = {}) {
        const plugins = options.plugins || [];

        plugins.push(
            sass({
                omitSourceMapUrl: true,
                sourceMapContents: true,
                sourceMapEmbed: false,
                sourceMap: !options.map,
            }),
            autoprefixer({
                browsers: options.targets,
                grid: true,
                flexbox: true,
                remove: false,
            }),
            unset(),
            focusVisible(),
            focusWithin({
                replaceWith: '.focus-within',
            }),
        );

        if (options.production) {
            plugins.push(
                cssnano({
                    preset: ['default', {
                        discardUnused: false,
                        reduceIdents: false,
                        mergeRules: false,
                        zindex: false,
                    }],
                })
            );
        }

        if (options.lint !== false) {
            plugins.push(
                stylelintPlugin(StyleLint.detectConfig(app, project)),
            );
        }

        return {
            input: options.input,
            output: options.output,
            map: options.map,
            plugins,
        };
    }

    constructor(options = {}) {
        this.options = options;
    }

    async build() {
        let data = fs.readFileSync(this.options.input, 'utf8');
        let config = {
            from: this.options.input,
            to: this.options.output,
            map: this.options.map !== false ? {
                inline: this.options.map === 'inline',
                sourcesContent: true,
            } : false,
        };
        this.result = await postcss(this.options.plugins || [])
            .process(data, config);

        return this.result;
    }

    async write() {
        if (this.options.output) {
            fs.ensureDirSync(path.dirname(this.options.output));

            let externalMapFile = this.options.map !== false && this.options.map !== 'inline' && this.result.map;
            let content = this.result.css.toString();
            if (externalMapFile) {
                content += `\n/*# sourceMappingURL=${path.basename(this.options.output)}.map */`;
                fs.writeFileSync(`${this.options.output}.map`, this.result.map);
            }

            fs.writeFileSync(this.options.output, content);
        }
    }

    get linter() {
        if (!this.result) {
            return null;
        }

        return this.result.linter;
    }

    get files() {
        if (!this.result) {
            return [this.options.input];
        }

        return [
            this.options.input,
            ...(this.result.dependencies || []),
        ];
    }
}

module.exports = PostCSS;
