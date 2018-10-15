const { ConverterComponent } = require('typedoc/dist/lib/converter/components');
const { Converter } = require('typedoc/dist/lib/converter/converter');
const { getRawComment } = require('typedoc/dist/lib/converter/factories/comment');

class DemoPlugin extends ConverterComponent {
    get componentName() {
        return 'demo';
    }

    initialize() {
        this.listenTo(this.owner, {
            [Converter.EVENT_CREATE_DECLARATION]: this.onDeclaration,
        });
    }

    onDeclaration(context, reflection, node) {
        if (!node) {
            return;
        }

        let comment = getRawComment(node);
        if (!comment) {
            return;
        }

        let match = comment.match(/@see\s+\{@link\s+(https:\/\/stackblitz\.com\/[^}]+)\}/);
        if (!match) {
            return;
        }

        reflection.demo = match[1];
    }
}

module.exports = DemoPlugin;
