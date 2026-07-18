#!/usr/bin/env node

const { execSync } = require('child_process');

const port = process.argv[2] || '8083';

function getPidsForPort(targetPort) {
  try {
    const output = execSync(`netstat -ano -p tcp | findstr :${targetPort}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line.includes(`:${targetPort}`));

    const pids = new Set();
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) {
        pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const pids = getPidsForPort(port);

if (pids.length === 0) {
  console.log(`[free-port] Port ${port} is already free.`);
  process.exit(0);
}

let killed = 0;
for (const pid of pids) {
  if (killPid(pid)) {
    killed += 1;
  }
}

console.log(`[free-port] Found ${pids.length} process(es) on port ${port}, killed ${killed}.`);