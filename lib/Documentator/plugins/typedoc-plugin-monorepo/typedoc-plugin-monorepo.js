const { ReflectionKind } = require('typedoc/dist/lib/models/reflections/abstract');
const { ConverterComponent } = require('typedoc/dist/lib/converter/components');
const { Converter } = require('typedoc/dist/lib/converter/converter');
const { Comment } = require('typedoc/dist/lib/models/comments');
const { CommentPlugin } = require('typedoc/dist/lib/converter/plugins/CommentPlugin');
const marked = require('marked');
const Project = require('../../../Project');

marked.setOptions({
    renderer: new marked.Renderer(),
    pedantic: false,
    gfm: true,
    tables: true,
    breaks: false,
    sanitize: false,
    smartLists: true,
    smartypants: false,
});

class MonorepoPlugin extends ConverterComponent {
    get componentName() {
        return 'monorepo';
    }

    initialize() {
        this.listenTo(this.owner, {
            [Converter.EVENT_BEGIN]: this.onBegin,
            [Converter.EVENT_CREATE_DECLARATION]: this.onDeclaration,
            [Converter.EVENT_RESOLVE_BEGIN]: this.onBeginResolve,
        });
    }

    onBegin() {
        this.modules = [];
    }

    onDeclaration(context, reflection, node) {
        if (!node || !node.fileName) {
            return;
        }

        let fileName = node.fileName;
        let project = Project.resolve(fileName);

        if (!project) {
            return;
        }

        let main = [
            project.get('module') && project.file(project.get('module')),
            project.get('main') && project.file(project.get('main')),
        ].find((file) => file && file.exists());

        this.modules.push({
            name: project.scopeModule,
            reflection,
            index: main && main.path === fileName,
            project,
        });
    }

    onBeginResolve(context) {
        let reflections = Object.values(context.project.reflections);

        this.modules.forEach((item) => {
            const { reflection, name, project } = item;
            const mergeTarget = reflections.find((ref) => ref.name === name);

            if (!mergeTarget) {
                reflection.kind = ReflectionKind.Module;
                reflection.name = name;
                if (project.file('README.md').exists()) {
                    let content = project.file('README.md').read();
                    reflection.comment = new Comment('', marked(content));
                }
                return;
            }

            if (!mergeTarget.children) {
                mergeTarget.children = [];
            }

            let childrenOfRenamed = reflections.filter((ref) => ref.parent === reflection);
            childrenOfRenamed.forEach((ref) => {
                ref.parent = mergeTarget;
                mergeTarget.children.push(ref);
            });

            if (reflection.children) {
                reflection.children.length = 0;
            }

            CommentPlugin.removeReflection(context.project, reflection);
        });
    }
}

module.exports = MonorepoPlugin;
