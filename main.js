const {ipcMain, app} = require('electron');
const {ArcWindowsManager} = require('./scripts/main/windows-manager');
const {UpdateStatus} = require('./scripts/main/update-status');
const {ArcMainMenu} = require('./scripts/main/main-menu');
const {ArcIdentity} = require('./scripts/main/oauth2');
const {DriveExport} = require('./scripts/main/drive-export');
const {SessionManager} = require('./scripts/main/session-manager');
const {AppOptions} = require('./scripts/main/app-options');
const {RemoteApi} = require('./scripts/main/remote-api');
const {AppDefaults} = require('./scripts/main/app-defaults');
const {ContentSearchService} = require('./scripts/main/search-service');
const {AppPrompts} = require('./scripts/main/app-prompts.js');
const log = require('electron-log');

/**
 * Main application object controling app's lifecycle.
 */
class Arc {
  /**
   * @constructor
   */
  constructor() {
    this._registerProtocols();
    const startupOptions = this._processArguments();
    this.menu = new ArcMainMenu();
    this.wm = new ArcWindowsManager(startupOptions.getOptions());
    this.us = new UpdateStatus(this.wm, this.menu);
    this.sm = new SessionManager(this.wm);
    this.remote = new RemoteApi(this.wm);
    this.prompts = new AppPrompts();
    this.gdrive = new DriveExport();
    this._listenMenu();
  }
  /**
   * Attaches used event listeners to the `electron.app` object.
   */
  attachListeners() {
    app.on('ready', this._readyHandler.bind(this));
    app.on('window-all-closed', this._allClosedHandler.bind(this));
    app.on('activate', this._activateHandler.bind(this));
  }
  /**
   * Registers application protocol and adds a handler.
   * The handler will be called when a user navigate to `protocol://data`
   * url in a browser. This is used when opening / creating a file from
   * Google Drive menu.
   */
  _registerProtocols() {
    log.info('Registering arc-file protocol');
    app.setAsDefaultProtocolClient('arc-file');
    app.on('open-url', (event, url) => {
      log.info('arc-file protocol handles ', url);
      event.preventDefault();
      let fileData = url.substr(11);
      let parts = fileData.split('/');
      switch (parts[0]) {
        case 'drive':
          // arc-file://drive/open/file-id
          // arc-file://drive/create/file-id
          this.wm.open('/request/drive/' + parts[1] + '/' + parts[2]);
        break;
      }
    });
  }
  // processes start arguments
  _processArguments() {
    const startupOptions = new AppOptions();
    startupOptions.parse();
    return startupOptions;
  }

  _readyHandler() {
    const defaults = new AppDefaults();
    return defaults.prepareEnvironment()
    .catch((cause) => {
      log.error('Unable to prepare the environment.', cause.message);
      log.error(cause);
    })
    .then(() => {
      log.info('Application is now ready');
      ArcIdentity.listen();
      this.wm.listen();
      this.prompts.listen();
      this.us.listen();
      this.gdrive.listen();
      this.wm.open();
      if (!this.isDebug()) {
        this.us.start();
      }
      this.menu.build();
      this.sm.start();
    });
  }
  /**
   * Quits when all windows are closed.
   */
  _allClosedHandler() {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
  /**
   * On OS X it's common to re-create a window in the app when the
   * dock icon is clicked and there are no other windows open.
   */
  _activateHandler() {
    if (!this.wm.hasWindow) {
      this.wm.open();
    }
  }
  /**
   * Listens on menu actions.
   */
  _listenMenu() {
    this.menu.on('menu-action', this._menuHandler.bind(this));
  }
  /**
   * Event handler for menu actions.
   *
   * @param {[type]} action [description]
   * @param {[type]} win [description]
   * @return {[type]} [description]
   */
  _menuHandler(action, win) {
    if (action.indexOf('application') === 0) {
      return this._handleApplicationAction(action.substr(12), win);
    }
    if (action.indexOf('request') === 0) {
      return win.webContents.send('request-action', action.substr(8));
    }
  }
  /**
   * Handles `application` group of commands
   *
   * @param {String} action Application action.
   * @param {BrowserWindow} win Target window.
   */
  _handleApplicationAction(action, win) {
    let windowCommand = 'command';
    switch (action) {
      case 'quit':
        app.quit();
      break;
      case 'open-saved':
      case 'open-history':
      case 'open-drive':
      case 'open-messages':
      case 'show-settings':
      case 'about':
      case 'open-license':
      case 'import-data':
      case 'export-data':
      case 'login-external-webservice':
      case 'open-cookie-manager':
      case 'open-hosts-editor':
      case 'open-themes':
        win.webContents.send(windowCommand, action);
      break;
      case 'new-window':
        this.wm.open();
      break;
      case 'open-privacy-policy':
      case 'open-documentation':
      case 'open-faq':
      case 'open-discussions':
      case 'report-issue':
      case 'search-issues':
      case 'web-session-help':
        let {HelpManager} = require('./scripts/main/help-manager');
        HelpManager.helpWith(action);
      break;
      case 'task-manager':
        this.wm.openTaskManager();
      break;
      case 'find':
        if (win.webContents.getURL().indexOf('search-bar') !== -1) {
          // ctrl+f from search bar.
          return;
        }
        let srv = ContentSearchService.getService(win);
        if (srv && srv.isOpened()) {
          srv.focus();
          return;
        }
        if (!srv) {
          srv = new ContentSearchService(win);
        }
        srv.open();
      break;
    }
  }
  /**
   * Returns true if current instance is being debugged.
   *
   * @return {Boolean} [description]
   */
  isDebug() {
    return !!process.argv.find((i) => i.indexOf('--inspect') !== -1);
  }
}

const arcApp = new Arc();
arcApp.attachListeners();

// Unit testing
if (process.env.NODE_ENV === 'test') {
  const testInterface = require('./scripts/main/test-interface');
  testInterface(app, arcApp);
}

if (arcApp.isDebug()) {
  global.arcApp = arcApp;
}
// Dev...
ipcMain.on('open-theme-editor', (event, data) => {
  log.info('Starting theme editor');
  const windowId = event.sender.id;
  const {ThemesEditor} = require('./scripts/main/themes-editor.js');
  const editor = new ThemesEditor(windowId, data);
  editor.run();
});
