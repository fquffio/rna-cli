const app = require('electron').app;
const BrowserWindow = require('electron').BrowserWindow;

const opts = '%OPTS%';
let mainWindow = null;

if (Array.isArray(opts.commandLineSwitches)) {
    opts.commandLineSwitches.forEach((cliSwitch) => {
        let args = cliSwitch;
        if (!Array.isArray(args)) {
            args = [args];
        }
        app.commandLine.appendSwitch.apply(app.commandLine.appendSwitch, args);
    });
}

if (process.platform === 'darwin' && opts.skipTaskbar === true) {
    app.dock.hide();
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('ready', () => {
    mainWindow = new BrowserWindow(opts);
    mainWindow.loadURL('%URL%');
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
});
