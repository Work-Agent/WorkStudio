#!/usr/bin/env node
import { resolve } from 'node:path';
import { buildPlugin } from './build.ts';

const root = resolve(process.argv[2] ?? process.cwd());

buildPlugin(root)
  .then((result) => {
    console.log(`commands: ${result.commands.length}`);
    for (const file of result.files) console.log(`wrote ${file}`);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
