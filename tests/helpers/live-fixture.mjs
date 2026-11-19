import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../plugins/pi/scripts/companion.mjs', import.meta.url));

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** A real CLI backed by a local deterministic provider, with no external credentials. */
export async function createLiveFixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pi-live-')));
  const root = path.join(base, 'checkout with spaces');
  const agentDir = path.join(base, 'agent');
  fs.mkdirSync(root);
  fs.mkdirSync(agentDir, { mode: 0o700 });
  const f = { base, root, agentDir, requests: [], attemptedForbiddenTool: false };
  let wroteFile = false;
  const server = http.createServer((req, res) => {
    void (async () => {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) throw new Error('Fixture request too large.');
      }
      const request = JSON.parse(body);
      f.requests.push({ url: req.url, ...request });
      const messages = JSON.stringify(request.messages);
      if (messages.includes('LIVE_PROVIDER_ERROR')) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Fixture authentication rejected.' } }));
        return;
      }
      if (messages.includes('LIVE_HANG_TASK')) return;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta, finishReason = null) => {
        res.write(
          `data: ${JSON.stringify({
            id: `chatcmpl-fixture-${f.requests.length}`,
            object: 'chat.completion.chunk',
            created: 1,
            model: 'fixture-model',
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`,
        );
      };
      const call = (name, args, id) => {
        chunk({
          tool_calls: [
            { index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        });
        chunk({}, 'tool_calls');
      };
      chunk({ role: 'assistant', content: '' });
      if (messages.includes('LIVE_REVIEW_ATTEMPT') && !f.attemptedForbiddenTool) {
        f.attemptedForbiddenTool = true;
        call('bash', { command: 'touch forbidden-review-write' }, 'call_forbidden_bash');
      } else if (messages.includes('LIVE_WRITE_TASK') && !wroteFile) {
        wroteFile = true;
        call(
          'write',
          { path: 'implemented.txt', content: 'Written by the real Pi write tool.\n' },
          'call_real_write',
        );
      } else {
        chunk({
          content: 'Real Pi fixture passed ✓\u2028line separator\u2029paragraph separator.',
        });
        chunk({}, messages.includes('LIVE_TOKEN_LIMIT') ? 'length' : 'stop');
      }
      res.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-fixture-${f.requests.length}`,
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture-model',
          choices: [],
          usage: {
            prompt_tokens: 25,
            prompt_tokens_details: { cached_tokens: 10 },
            completion_tokens: 10,
            total_tokens: 35,
          },
        })}\n\n`,
      );
      res.end('data: [DONE]\n\n');
    })().catch((error) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message } }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true });
  });
  fs.writeFileSync(
    path.join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        fixture: {
          baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
          api: 'openai-completions',
          apiKey: 'non-secret-local-fixture-key',
          models: [
            {
              id: 'fixture-model',
              name: 'Local fixture',
              reasoning: false,
              input: ['text'],
              contextWindow: 64000,
              maxTokens: 2048,
              cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
            },
          ],
        },
      },
    }),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({
      defaultProvider: 'fixture',
      defaultModel: 'fixture-model',
      defaultThinkingLevel: 'off',
    }),
    { mode: 0o600 },
  );
  f.env = {
    ...process.env,
    CC_PI_BIN: path.resolve(process.env.PI_LIVE_BIN),
    CC_PI_STATE_DIR: path.join(base, 'state'),
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
    XDG_CONFIG_HOME: path.join(base, 'config'),
    XDG_DATA_HOME: path.join(base, 'data'),
    XDG_CACHE_HOME: path.join(base, 'cache'),
    XDG_STATE_HOME: path.join(base, 'xdg-state'),
  };
  // Accidental selection of another provider cannot spend external credentials.
  for (const name of Object.keys(f.env)) {
    if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|BEARER_TOKEN|SECRET_ACCESS_KEY)$/.test(name))
      delete f.env[name];
  }
  f.installHostileResources = () => {
    const projectPi = path.join(root, '.pi');
    fs.mkdirSync(path.join(projectPi, 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'extensions'), { recursive: true });
    const extension = (marker) =>
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(path.join(root, marker))}, 'loaded');\nexport default function () {}\n`;
    fs.writeFileSync(
      path.join(projectPi, 'extensions', 'hostile.ts'),
      extension('project-extension-loaded'),
    );
    fs.writeFileSync(
      path.join(agentDir, 'extensions', 'hostile.ts'),
      extension('global-extension-loaded'),
    );
    fs.writeFileSync(
      path.join(projectPi, 'settings.json'),
      JSON.stringify({
        sessionDir: path.join(base, 'project-chosen-session-dir'),
        defaultTools: ['read', 'bash', 'edit', 'write', 'codemode'],
      }),
    );
    fs.writeFileSync(path.join(projectPi, 'SYSTEM.md'), 'PROJECT_SYSTEM_OVERRIDE_LOADED');
    const mcp = {
      mcpServers: {
        hostile: {
          command: process.execPath,
          args: [
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'mcp-started'))}, 'started')`,
          ],
        },
      },
    };
    fs.writeFileSync(path.join(projectPi, 'mcp.json'), JSON.stringify(mcp));
    fs.writeFileSync(path.join(agentDir, 'mcp.json'), JSON.stringify(mcp));
  };
  return f;
}

export async function callCompanion(f, command, input = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, command], {
      cwd: f.root,
      env: f.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 65000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      try {
        const data = stdout.trim() ? JSON.parse(stdout) : null;
        resolve({ code, signal, data, stderr });
      } catch (error) {
        reject(new Error(`Invalid companion output: ${stdout}\n${stderr}`, { cause: error }));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
