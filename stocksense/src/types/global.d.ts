import type { AppApi } from './app';

declare global {
  interface Window {
    appApi?: AppApi;
  }
}

export {};
