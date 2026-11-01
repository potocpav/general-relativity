#!/usr/bin/env node
// Runs test/index.html in headless Chromium and reports the results.
//
// Usage: node test/run.mjs
// The browser is taken from $CHROME, or the first of chromium / google-chrome
// found in PATH. Extra browser flags can be given in $CHROME_FLAGS.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const timeoutMs = 60000;

const contentTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.glsl': 'text/plain', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end();
      } else {
        res.writeHead(200, {'Content-Type': contentTypes[path.extname(file)] ?? 'application/octet-stream'}).end(data);
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function findBrowser() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    if (spawnSync('which', [name]).status === 0) return name;
  }
  throw new Error('No Chromium found; set $CHROME to the browser executable.');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(f, what) {
  const start = Date.now();
  for (;;) {
    const value = await f();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(100);
  }
}

// Minimal Chrome DevTools Protocol client.
async function connect(wsUrl, onEvent) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let lastId = 0;
  const pending = new Map();
  ws.onmessage = message => {
    const data = JSON.parse(message.data);
    if (data.id !== undefined) {
      pending.get(data.id)?.(data);
      pending.delete(data.id);
    } else {
      onEvent(data);
    }
  };
  return {
    send: (method, params = {}) => new Promise(resolve => {
      pending.set(++lastId, resolve);
      ws.send(JSON.stringify({id: lastId, method, params}));
    }),
    close: () => ws.close(),
  };
}

async function main() {
  const server = await startServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-test-'));
  const browser = spawn(findBrowser(), [
    '--headless=new',
    // software rendering, so that results don't depend on the GPU
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    ...(process.env.CHROME_FLAGS ?? '').split(' ').filter(Boolean),
    'about:blank',
  ], {stdio: 'ignore'});

  try {
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    const port = await until(() => fs.existsSync(portFile)
      ? fs.readFileSync(portFile, 'utf8').split('\n')[0] || undefined
      : undefined, 'the browser to start');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = targets.find(t => t.type == 'page');

    const cdp = await connect(page.webSocketDebuggerUrl, event => {
      if (event.method == 'Runtime.exceptionThrown') {
        console.error('page exception:', event.params.exceptionDetails.exception?.description
          ?? event.params.exceptionDetails.text);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/test/index.html`});

    const results = await until(async () => {
      const response = await cdp.send('Runtime.evaluate', {expression: 'window.testResults', returnByValue: true});
      return response.result?.result?.value;
    }, 'the test results');
    cdp.close();

    for (const r of results.results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}: ${r.message}`);
    }
    const failed = results.results.filter(r => !r.ok).length;
    console.log(failed ? `\n${failed} test(s) failed` : `\nAll ${results.results.length} tests passed`);
    return results.ok;
  } finally {
    browser.kill();
    server.close();
    await sleep(200);
    fs.rmSync(userDataDir, {recursive: true, force: true});
  }
}

main().then(ok => process.exit(ok ? 0 : 1), err => {
  console.error(err);
  process.exit(1);
});
