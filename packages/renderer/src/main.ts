// First: lets the connection string parser load in a renderer without SharedArrayBuffer.
import './shared-array-buffer-stub';

import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((err: unknown) => console.error(err));
