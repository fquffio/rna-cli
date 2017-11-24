#! /usr/bin/env node

const CLI = require('./lib/cli.js');
const program = new CLI();

program.version('0.20.1');

require('./commands/help/index.js')(program);
require('./commands/setup/index.js')(program);
require('./commands/add/index.js')(program);
require('./commands/remove/index.js')(program);
require('./commands/bootstrap/index.js')(program);
require('./commands/lint/index.js')(program);
require('./commands/build/index.js')(program);
require('./commands/icons/index.js')(program);
require('./commands/sw/index.js')(program);
require('./commands/serve/index.js')(program);
require('./commands/unit/index.js')(program);
require('./commands/publish/index.js')(program);
require('./commands/wiki/index.js')(program);
require('./commands/start/index.js')(program);
require('./commands/run/index.js')(program);

/** DEPRECATED COMMANDS */
require('./commands/__deprecated/watch/index.js')(program);

program.start();
