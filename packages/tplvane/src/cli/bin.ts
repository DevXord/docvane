#!/usr/bin/env node
// The tplvane command. Runs main with this process and sets the exit code; no top-level await.
import process from 'node:process';
import { nodeIo } from './io';
import { main } from './main';

void main(process.argv.slice(2), nodeIo()).then((code) => {
  process.exitCode = code;
});
