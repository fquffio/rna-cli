const { ReflectionKind, ReflectionFlag } = require('typedoc/dist/lib/models/reflections/abstract');
const { ArrayType, UnknownType, UnionType } = require('typedoc/dist/lib/models/types');
const { DeclarationReflection } = require('typedoc/dist/lib/models/reflections/declaration');
const { ConverterComponent } = require('typedoc/dist/lib/converter/components');
const { Converter } = require('typedoc/dist/lib/converter/converter');
const { Comment } = require('typedoc/dist/lib/models/comments');
const { CommentPlugin } = require('typedoc/dist/lib/converter/plugins/CommentPlugin');

class JSDocPlugin extends ConverterComponent {
    get componentName() {
        return 'jsdoc';
    }

    initialize() {
        this.listenTo(this.owner, {
            [Converter.EVENT_BEGIN]: this.onBegin,
            [Converter.EVENT_CREATE_DECLARATION]: this.onDeclaration,
            [Converter.EVENT_RESOLVE_BEGIN]: this.onBeginResolve,
        });
    }

    onBegin() {
        this.propertiesToAdd = [];
        this.seeMap = [];
    }

    onDeclaration(context, reflection, node) {
        if (!node) {
            return;
        }

        if (!reflection.comment) {
            return;
        }

        const tags = reflection.comment.tags || [];

        tags.forEach((tag) => {
            if (tag.tagName === 'class') {
                if (tag.text && tag.text.trim()) {
                    reflection.name = tag.text.trim();
                }
                return;
            }
            if (tag.tagName === 'property') {
                let match = tag.text.trim().match(/(?:\{([^}]*)\})?(?:\s+([^\s]+))(?:\s+(.*))?/);
                if (!match || !match[2]) {
                    return;
                }
                this.propertiesToAdd.push({
                    reflection,
                    property: {
                        types: match[1] ? match[1].split('|') : [],
                        name: match[2],
                        description: match[3] || '',
                    },
                });
                return;
            }
            if (tag.tagName === 'see') {
                this.seeMap.push({
                    text: tag.text.trim(),
                    reflection,
                });
                return;
            }

        });

        CommentPlugin.removeTags(reflection.comment, 'class');
        CommentPlugin.removeTags(reflection.comment, 'alias');
        CommentPlugin.removeTags(reflection.comment, 'fileoverview');
        CommentPlugin.removeTags(reflection.comment, 'type');
        CommentPlugin.removeTags(reflection.comment, 'property');
        CommentPlugin.removeTags(reflection.comment, 'see');
    }

    onBeginResolve(context) {
        let reflections = Object.values(context.project.reflections);
        reflections.forEach((reflection) => {
            if (reflection.signatures) {
                reflection.signatures.forEach((signature) => {
                    if (!signature.comment || !signature.comment.tags) {
                        return;
                    }
                    signature.comment.tags.forEach((tag) => {
                        if (tag.tagName === 'returns' || tag.tagName === 'return') {
                            tag.text = tag.text.trim();
                            return;
                        }
                        if (tag.tagName === 'see') {
                            reflection.see = reflection.see || [];
                            reflection.see.push({
                                text: tag.text.trim(),
                            });
                            return;
                        }
                        if (tag.tagName === 'memberof') {
                            CommentPlugin.removeTags(signature.comment, 'memberof');
                            return;
                        }
                    });

                    CommentPlugin.removeTags(signature.comment, 'see');
                });
            }
        });

        this.propertiesToAdd.forEach(({ reflection, property }) => {
            reflection.children = reflection.children || [];
            let child = new DeclarationReflection(reflection, property.name, ReflectionKind.Property);
            child.setFlag(ReflectionFlag.Exported);
            if (property.types.length) {
                if (property.types.length === 1) {
                    child.type = literalToType(property.types[0]);
                } else {
                    child.type = new UnionType(property.types.map((type) => literalToType(type)));
                }
            }
            if (property.description) {
                child.comment = new Comment(property.description);
            }
            child.sources = reflection.sources;
            reflection.children.unshift(child);
        });

        this.seeMap.forEach(({ reflection, text }) => {
            reflection.see = reflection.see || [];
            reflection.see.push({
                text,
            });
        });
    }
}

function literalToType(type) {
    if (type.toLowerCase() === 'array') {
        return new ArrayType(new UnknownType('any'));
    }
    return new UnknownType(type);
}

module.exports = JSDocPlugin;
