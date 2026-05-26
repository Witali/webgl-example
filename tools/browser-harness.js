/*
 * Purpose: Minimal Node browser harness for local image tests without Playwright.
 * Processing blocks:
 * - Start a temporary static file server and launch Edge/Chrome with DevTools.
 * - Poll the target page by evaluating a result expression.
 * - Use a small WebSocket client to talk to the DevTools protocol.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

// End-to-end harness: serve files, launch a browser, poll DevTools, and clean up.
async function runBrowserPage(options) {
  const projectRoot = options.projectRoot;
  const browserPath = resolveBrowserExecutable();

  if (!fs.existsSync(browserPath)) {
    throw new Error(`Browser executable was not found at ${browserPath}.`);
  }

  const server = createStaticServer(projectRoot);

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const debugPort = 9300 + Math.floor(Math.random() * 400);
      const browserUrl = createBrowserUrl(port, options.pagePath, options.query || {});
      const userDataDir = path.join(os.tmpdir(), `gpu-jpeg-browser-${Date.now()}`);
      const browser = spawn(browserPath, createBrowserArgs({
        debugPort,
        userDataDir,
        url: browserUrl,
      }), {
        env: createBrowserEnv(),
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        browser.kill();
        server.close();
        fs.rm(userDataDir, { force: true, recursive: true }, () => {});
      };
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(new Error(`Timed out waiting for browser result. ${stderr.trim()}`));
      }, options.timeoutMs || 120000);

      browser.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      browser.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      browser.on("close", (code) => {
        if (!settled && code !== null && code !== 0 && stdout) {
          console.error(stdout.trim());
        }
      });

      pollForResult({
        debugPort,
        emulation: options.emulation,
        pagePath: options.pagePath,
        resultExpression: options.resultExpression,
        snapshotExpression: options.snapshotExpression,
        targetTimeoutMs: options.targetTimeoutMs,
        timeoutMs: (options.timeoutMs || 120000) - 5000,
      })
        .then((result) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve(result);
        })
        .catch((error) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          reject(new Error(`${error.message}\n${stderr.trim()}`));
        });
    });
  });
}

function createBrowserEnv() {
  const env = { ...process.env };

  delete env.BROWSER;
  delete env.BROWSER_PATH;
  delete env.EDGE_HEADLESS;
  delete env.EDGE_SWIFTSHADER;
  delete env.EDGE_PATH;
  delete env.CHROME_PATH;
  delete env.BROWSER_TARGET_TIMEOUT_MS;
  delete env.BROWSER_TIMEOUT_MS;
  delete env.GPU_READBACK;

  return env;
}

// Browser resolution supports explicit paths, common Edge/Chrome names, and Windows default browser.
function resolveBrowserExecutable() {
  const requestedBrowser = process.env.BROWSER || "edge";

  if (process.env.BROWSER_PATH) {
    return process.env.BROWSER_PATH;
  }

  if (requestedBrowser.includes("\\") || requestedBrowser.includes("/") || requestedBrowser.endsWith(".exe")) {
    return requestedBrowser;
  }

  switch (requestedBrowser.toLowerCase()) {
    case "default":
      return resolveDefaultWindowsBrowser();
    case "edge":
    case "msedge":
      return process.env.EDGE_PATH ||
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    case "chrome":
      return process.env.CHROME_PATH ||
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    default:
      return requestedBrowser;
  }
}

function resolveDefaultWindowsBrowser() {
  if (process.platform !== "win32") {
    throw new Error("BROWSER=default is currently implemented for Windows only.");
  }

  const userChoiceKey = "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice";
  const progId = regQueryValue(userChoiceKey, "ProgId");
  const command = regQueryValue(`HKCR\\${progId}\\shell\\open\\command`, null);
  const executable = parseExecutableFromCommand(expandWindowsEnvironment(command));

  if (!executable) {
    throw new Error(`Could not resolve default browser executable from command: ${command}`);
  }

  return executable;
}

function regQueryValue(key, valueName) {
  const args = valueName ? ["query", key, "/v", valueName] : ["query", key, "/ve"];
  const output = execFileSync("reg", args, { encoding: "utf8" });
  const line = output.split(/\r?\n/).find((entry) => /REG_(?:SZ|EXPAND_SZ)/.test(entry));

  if (!line) {
    throw new Error(`Could not read registry value ${valueName || "(Default)"} from ${key}`);
  }

  const match = line.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/);

  if (!match) {
    throw new Error(`Could not parse registry output: ${line}`);
  }

  return match[1].trim();
}

function parseExecutableFromCommand(command) {
  const quoted = command.match(/^\s*"([^"]+\.exe)"/i);

  if (quoted) {
    return quoted[1];
  }

  const unquoted = command.match(/^\s*([^\s]+\.exe)/i);

  return unquoted ? unquoted[1] : null;
}

function expandWindowsEnvironment(value) {
  return value.replace(/%([^%]+)%/g, (match, name) => {
    return process.env[name] || match;
  });
}

// Static server keeps tests close to production browser behavior while blocking path traversal.
function createStaticServer(projectRoot) {
  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const filePath = safeResolve(projectRoot, requestUrl.pathname);

    if (!filePath) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(data);
    });
  });
}

function createBrowserUrl(port, pagePath, query) {
  const url = new URL(`http://127.0.0.1:${port}${pagePath}`);

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

function createBrowserArgs({ debugPort, userDataDir, url }) {
  const headlessMode = process.env.EDGE_HEADLESS || "new";
  const useHeadless = headlessMode !== "0";
  const useSwiftShader = process.env.EDGE_SWIFTSHADER !== "0";
  const browserArgs = [
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    url,
  ];

  if (useHeadless) {
    browserArgs.unshift(headlessMode === "old" ? "--headless" : "--headless=new");
  }

  if (useSwiftShader) {
    browserArgs.splice(5, 0, "--use-angle=swiftshader", "--enable-unsafe-swiftshader");
  }

  if (process.env.BROWSER_DISABLE_GPU_SANDBOX === "1") {
    browserArgs.splice(5, 0, "--disable-gpu-sandbox");
  }

  if (process.env.BROWSER_ENABLE_WEBGPU === "1") {
    browserArgs.splice(5, 0, "--enable-unsafe-webgpu");
  }

  return browserArgs;
}

// DevTools polling waits for the page target and evaluates the caller's result expression.
async function pollForResult(options) {
  const target = await waitForPageTarget(
    options.debugPort,
    options.pagePath,
    options.targetTimeoutMs
  );
  const client = await DevToolsWebSocket.connect(target.webSocketDebuggerUrl);

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    if (options.emulation) {
      await applyBrowserEmulation(client, options.emulation);
    }

    const deadline = Date.now() + options.timeoutMs;
    let lastSnapshot = null;

    while (Date.now() < deadline) {
      const response = await client.send("Runtime.evaluate", {
        expression: options.resultExpression,
        returnByValue: true,
        awaitPromise: false,
      });
      const remoteResult = response.result && response.result.result;
      const value = remoteResult && remoteResult.value;

      if (value) {
        return value;
      }

      if (options.snapshotExpression) {
        const snapshot = await client.send("Runtime.evaluate", {
          expression: options.snapshotExpression,
          returnByValue: true,
          awaitPromise: false,
        });

        lastSnapshot = snapshot.result &&
          snapshot.result.result &&
          snapshot.result.result.value;
      }

      await delay(250);
    }

    throw new Error(`Timed out waiting for browser result. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
  } finally {
    client.close();
  }
}

async function applyBrowserEmulation(client, emulation) {
  const width = Number(emulation.width || 390);
  const height = Number(emulation.height || 844);
  const deviceScaleFactor = Number(emulation.deviceScaleFactor || 3);
  const mobile = emulation.mobile !== false;

  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: emulation.touch !== false,
    maxTouchPoints: Number(emulation.maxTouchPoints || 5),
  });

  if (emulation.userAgent) {
    await client.send("Emulation.setUserAgentOverride", {
      userAgent: emulation.userAgent,
      platform: emulation.platform || "Android",
    });
  }

  if (emulation.reload !== false) {
    await client.send("Page.reload", { ignoreCache: true });
    await delay(250);
  }
}

async function waitForPageTarget(debugPort, pagePath, targetTimeoutMs) {
  const requestedTimeoutMs = Number(targetTimeoutMs || process.env.BROWSER_TARGET_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
    ? requestedTimeoutMs
    : 120000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = targets.find((target) => {
        return target.type === "page" &&
          target.webSocketDebuggerUrl &&
          target.url.includes(pagePath);
      });

      if (page) {
        return page;
      }
    } catch (error) {
      // Edge may need a moment before the debugging endpoint is ready.
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for browser DevTools target after ${timeoutMs} ms.`);
}

function safeResolve(root, pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const target = path.resolve(root, `.${decodedPath}`);

  if (!target.startsWith(root)) {
    return null;
  }

  return target;
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".css":
      return "text/css; charset=utf-8";
    case ".glsl":
    case ".wgsl":
      return "text/plain; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";

      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Tiny WebSocket client is enough for the Chrome DevTools request/response pattern used here.
class DevToolsWebSocket {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (error) => {
      this.pending.forEach(({ reject }) => reject(error));
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const socket = net.createConnection(Number(parsed.port), parsed.hostname);
      const key = crypto.randomBytes(16).toString("base64");
      let handshake = Buffer.alloc(0);

      socket.on("connect", () => {
        socket.write([
          `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
          `Host: ${parsed.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n"));
      });

      socket.on("data", function onHandshake(chunk) {
        handshake = Buffer.concat([handshake, chunk]);

        const headerEnd = handshake.indexOf("\r\n\r\n");

        if (headerEnd === -1) {
          return;
        }

        const header = handshake.slice(0, headerEnd).toString("utf8");

        if (!header.includes(" 101 ")) {
          reject(new Error(`WebSocket handshake failed: ${header}`));
          socket.destroy();
          return;
        }

        socket.off("data", onHandshake);

        const client = new DevToolsWebSocket(socket);
        const rest = handshake.slice(headerEnd + 4);

        if (rest.length > 0) {
          client.receive(rest);
        }

        resolve(client);
      });

      socket.on("error", reject);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;

    this.nextId += 1;
    this.socket.write(encodeClientFrame(JSON.stringify({ id, method, params })));

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const frame = decodeServerFrame(this.buffer);

      if (!frame) {
        return;
      }

      this.buffer = this.buffer.slice(frame.bytesUsed);

      if (frame.opcode === 1) {
        const message = JSON.parse(frame.payload.toString("utf8"));

        if (message.id && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id);

          this.pending.delete(message.id);

          if (message.error) {
            pending.reject(new Error(JSON.stringify(message.error)));
          } else {
            pending.resolve(message);
          }
        }
      } else if (frame.opcode === 8) {
        this.close();
      }
    }
  }

  close() {
    this.socket.end();
  }
}

// WebSocket frame helpers implement just the text-frame subset needed by DevTools.
function encodeClientFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = crypto.randomBytes(4);
  const headerLength = payload.length < 126 ? 2 : 4;
  const frame = Buffer.alloc(headerLength + 4 + payload.length);

  frame[0] = 0x81;

  if (payload.length < 126) {
    frame[1] = 0x80 | payload.length;
  } else {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(payload.length, 2);
  }

  mask.copy(frame, headerLength);

  for (let index = 0; index < payload.length; index += 1) {
    frame[headerLength + 4 + index] = payload[index] ^ mask[index % 4];
  }

  return frame;
}

function decodeServerFrame(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 15;
  const masked = Boolean(second & 128);
  let length = second & 127;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }

    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }

    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    length = high * 2 ** 32 + low;
    offset += 8;
  }

  const maskOffset = offset;

  if (masked) {
    offset += 4;
  }

  if (buffer.length < offset + length) {
    return null;
  }

  const payload = Buffer.from(buffer.slice(offset, offset + length));

  if (masked) {
    const mask = buffer.slice(maskOffset, maskOffset + 4);

    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    opcode,
    payload,
    bytesUsed: offset + length,
  };
}

module.exports = { runBrowserPage };
