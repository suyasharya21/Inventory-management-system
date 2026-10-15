const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('appApi', {
  system: {
    getMeta: () => invoke('system:meta'),
    openPath: (path) => invoke('system:openPath', path),
  },
  speech: {
    status: () => invoke('speech:status'),
    requestPermission: () => invoke('speech:requestPermission'),
    transcribe: (payload) => invoke('speech:transcribe', payload),
  },
  auth: {
    status: () => invoke('auth:status'),
    signUp: (payload) => invoke('auth:signUp', payload),
    login: (payload) => invoke('auth:login', payload),
    signInGoogle: () => invoke('auth:signInGoogle'),
    completeBusiness: (payload) => invoke('auth:completeBusiness', payload),
    signOut: () => invoke('auth:signOut'),
  },
  business: {
    getProfile: () => invoke('business:getProfile'),
    updateProfile: (payload) => invoke('business:updateProfile', payload),
    chooseLogo: () => invoke('business:chooseLogo'),
    removeLogo: () => invoke('business:removeLogo'),
  },
  products: {
    list: (filters = {}) => invoke('products:list', filters),
    get: (id) => invoke('products:get', id),
    checkDuplicates: (payload) => invoke('products:checkDuplicates', payload),
    create: (payload, options = {}) => invoke('products:create', payload, options),
    update: (id, payload) => invoke('products:update', id, payload),
    updatePrices: (id, payload) => invoke('products:updatePrices', id, payload),
    setArchived: (id, archived) => invoke('products:setArchived', id, archived),
  },
  transactions: {
    create: (payload) => invoke('transactions:create', payload),
    list: (filters = {}) => invoke('transactions:list', filters),
  },
  smartEntry: {
    parse: (text) => invoke('smartEntry:parse', text),
    confirm: (parsed) => invoke('smartEntry:confirm', parsed),
  },
  reports: {
    definitions: () => invoke('reports:definitions'),
    view: (reportType, filters = {}) => invoke('reports:view', reportType, filters),
    exportExcel: (reportType, filters = {}) => invoke('reports:exportExcel', reportType, filters),
  },
  analytics: {
    dashboard: (filters = {}) => invoke('analytics:dashboard', filters),
    forecast: (filters = {}) => invoke('analytics:forecast', filters),
  },
  anomalies: {
    list: (filters = {}) => invoke('anomalies:list', filters),
    get: (id) => invoke('anomalies:get', id),
    summary: (filters = {}) => invoke('anomalies:summary', filters),
    runDetection: () => invoke('anomalies:runDetection'),
    updateStatus: (id, status, note) => invoke('anomalies:updateStatus', id, status, note),
  },
  audit: {
    list: (filters = {}) => invoke('audit:list', filters),
    getDiff: (id) => invoke('audit:getDiff', id),
    changeGraph: (filters = {}) => invoke('audit:changeGraph', filters),
    verifyIntegrity: () => invoke('audit:verifyIntegrity'),
  },
  nlpHelp: {
    suggestedQuestions: () => invoke('nlpHelp:suggestedQuestions'),
    parseQuestion: (text) => invoke('nlpHelp:parseQuestion', text),
    answer: (questionOrPlan) => invoke('nlpHelp:answer', questionOrPlan),
  },
  backup: {
    list: () => invoke('backup:list'),
    create: (options) => invoke('backup:create', options),
    createGoogleDrive: (options) => invoke('backup:createGoogleDrive', options),
    restore: (options) => invoke('backup:restore', options),
  },
  drive: {
    status: () => invoke('drive:status'),
    connect: () => invoke('drive:connect'),
    disconnect: () => invoke('drive:disconnect'),
  },
});
