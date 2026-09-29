#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { inspect } from './lib/inspect.mjs';
import { verify } from './lib/verify.mjs';
import { domains } from './lib/domains.mjs';
import { validateTask } from './lib/task-contract.mjs';

function usage() {
  return `craft-agent 0.3.0\n\nUsage:\n  node src/cli.mjs inspect [directory] [--out report.json]\n  node src/cli.mjs verify [directory] [--scripts check,test] [--out checks.json]\n  node src/cli.mjs domains [--out domains.json]\n  node src/cli.mjs validate-task task.json [--out validation.json]\n\nDomain listings are metadata, not implemented creator capabilities.\n`;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!['inspect', 'verify', 'domains', 'validate-task'].includes(command)) { process.stdout.write(usage()); process.exitCode = command ? 2 : 0; return; }
  let target = '.';
  let targetSet = false;
  let outputPath;
  let scripts;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--out' || arg === '--scripts') {
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--out') {
        if (outputPath) throw new Error('--out may be provided once');
        outputPath = value;
      } else {
        if (scripts) throw new Error('--scripts may be provided once');
        scripts = value.split(',').filter(Boolean);
        if (!scripts.length) throw new Error('--scripts needs a non-empty list');
      }
    }
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else if (!targetSet) { target = arg; targetSet = true; }
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (command !== 'verify' && scripts) throw new Error('--scripts only applies to verify');
  if (command === 'domains' && targetSet) throw new Error('domains does not take a path');
  if (command === 'validate-task' && !targetSet) throw new Error('validate-task needs a JSON file path');
  let report;
  if (command === 'inspect') report = await inspect(target);
  else if (command === 'verify') report = await verify(target, scripts);
  else if (command === 'domains') report = { schemaVersion: 1, domains };
  else {
    const source = await readFile(target);
    if (source.length > 1048576) throw new Error('Task file exceeds 1 MiB');
    let task;
    try { task = JSON.parse(source.toString('utf8')); }
    catch (error) { throw new Error(`Invalid task JSON: ${error.message}`); }
    report = validateTask(task);
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, serialized, { flag: 'w' });
  else process.stdout.write(serialized);
  if (command === 'verify' && !report.passed) process.exitCode = 1;
  if (command === 'validate-task' && !report.valid) process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 2; });
