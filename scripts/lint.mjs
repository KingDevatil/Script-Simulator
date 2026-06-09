import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['js/main.js'],
  bundle: true,
  format: 'iife',
  write: false,
  logLevel: 'info'
});

console.log('Lint passed');
