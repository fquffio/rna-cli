const minimatch = require('minimatch');
const chokidar = require('chokidar');
const { EventEmitter } = require('events');
const PriorityQueues = require('./PriorityQueues');

let GLOBAL_PROMISE;

/**
 * @typedef {Object} WatcherOptions
 * @property {Array|String} ignore A pattern of files to ignore.
 * @property {Number} debounce A timeout time before callback call.
 */

/**
 * @class Watcher
 * Helper for watching file changes.
 * Use the chokidar package instead of native fs.watch for some reasons.
 * @see https://github.com/paulmillr/chokidar#why
 */
class Watcher extends EventEmitter {
    /**
     * Create a Watcher instance.
     * @param {NavigatorDirectory} directory The directory to watch.
     * @param {WatcherOptions} options Options for the watcher.
     */
    constructor(directory, options = {}) {
        super();
        this.directory = directory;
        if (options.ignore) {
            if (!Array.isArray(options.ignore)) {
                options.ignore = [options.ignore];
            }
        } else {
            options.ignore = [];
        }
        options.ignore.push(/(^|[/\\])\../);
        this.options = options;
        this.queues = new PriorityQueues();
    }

    /**
     * Check if a file is ignored by the watcher.
     *
     * @param {NavigatorFile} file The file to check.
     * @return {boolean}
     */
    shouldIgnore(file) {
        const { ignore } = this.options;

        return ignore.some((ignoreRule) => {
            if (ignoreRule instanceof RegExp) {
                return ignoreRule.test(file.path);
            }
            if (typeof ignoreRule === 'string') {
                return minimatch(file.path, ignoreRule);
            }
            if (typeof ignoreRule === 'function') {
                return ignoreRule(file.path);
            }
            return false;
        });
    }

    /**
     * Start to watch files.
     * @param {Function} callback The function to call on files changes.
     */
    async watch(callback) {
        this.close();

        return new Promise((resolve) => {
            this.watcher = chokidar.watch(this.directory.path, {
                ignoreInitial: true,
                followSymlinks: true,
                cwd: this.directory.path,
                recursive: true,
            }).on('all', async (event, filePath) => {
                // Check if changed path is a file, ignores directories.
                if (!['add', 'change', 'unlink'].includes(event)) {
                    return;
                }
                let file = this.directory.file(filePath);
                // The file contents has changed and the first scan has finished.
                try {
                    // check if there is already a debounced callback for the file.
                    if (await this.queues.tick(file.path, 200)) {
                        GLOBAL_PROMISE = (async () => {
                            await GLOBAL_PROMISE;

                            // Check if ignored
                            if (this.shouldIgnore(file)) {
                                return;
                            }

                            this.emit('change', event, file);

                            try {
                                await callback(event, file);
                            } catch (err) {
                                // console.error(err);
                            }
                        })();
                    }
                } catch (err) {
                    // the same file has changed again.
                }
            }).on('ready', () => {
                resolve();
            });
        });
    }

    /**
     * Close the watcher.
     * @return {void}
     */
    close() {
        if (this.watcher) {
            this.watcher.close();
        }
    }
}

module.exports = Watcher;
