import { register } from 'node:module';

register('./app-alias-loader.mjs', import.meta.url);
