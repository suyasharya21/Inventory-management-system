import type { AppApi } from '../types/app';

export const isElectron = Boolean(window.appApi);
export const api = window.appApi as AppApi;
