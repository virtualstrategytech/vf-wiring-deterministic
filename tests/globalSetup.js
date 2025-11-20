/* tests/globalSetup.js */
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const http = require("http");
const path = require("path");

const secretFilePath = path.resolve(__dirname, "webhook.secret");
const pidFilePath = path.resolve(__dirname, "webhook.pid");
const logFilePath = path.resolve(__dirname, "globalSetup.log");
const portFilePath = path.resolve(__dirname, "webhook.port");
const childStdoutPath = path.resolve(__dirname, "webhook.child.stdout.log");
const childStderrPath = path.resolve(__dirname, "webhook.child.stderr.log");

// ---- Polyfill for browser-like origin in Node test env ----
(() => {
  const fallbackPort = process.env.PORT || 3000;
  const baseUrl =
    process.env.TEST_BASE_URL || `http://127.0.0.1:${fallbackPort}`;
  const ORIGIN = new URL(baseUrl).origin;

  if (!globalThis.location) globalThis.location = {};
  if (!globalThis.location.origin) globalThis.location.origin = ORIGIN;
  if (typeof globalThis.origin === "undefined") globalThis.origin = ORIGIN;
})();

// Utility: wait for a TCP port to accept connections
function waitForPort(port, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tryConnect() {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.on("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() - start > timeout) return reject(new Error("timeout"));
        setTimeout(tryConnect, 200);
      });
      sock.on("timeout", () => {
        sock.destroy();
        if (Date.now() - start > timeout) return reject(new Error("timeout"));
        setTimeout(tryConnect, 200);
      });
      sock.connect(port, "127.0.0.1");
    })();
  });
}

// Wait for /ready to return 200
function waitForReady(port, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tryReq() {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/ready",
          method: "GET",
          timeout: 1000,
        },
        (res) => {
          if (res.statusCode === 200) {
            res.destroy();
            return resolve();
          }
          res.on("data", () => {});
          res.on("end", () => {
            if (Date.now() - start > timeout)
              return reject(new Error("timeout"));
            setTimeout(tryReq, 200);
          });
        }
      );
      req.on("error", () => {
        if (Date.now() - start > timeout) return reject(new Error("timeout"));
        setTimeout(tryReq, 200);
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() - start > timeout) return reject(new Error("timeout"));
        setTimeout(tryReq, 200);
      });
      req.end();
    })();
  });
}

module.exports = async () => {
  const repoRoot = path.resolve(__dirname, "..");
  const webhookDir = path.join(repoRoot, "novain-platform", "webhook");

  const logStream = fs.createWriteStream(logFilePath, { flags: "a" });
  function logLine(...parts) {
    try {
      logStream.write(`[${new Date().toISOString()}] ${parts.join(" ")}\n`);
    } catch {}
  }

  logLine("globalSetup: starting; webhookDir=", webhookDir);

  // Detect already-running server on Actions (informational only)
  let serverDetected = false;
  if (
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.USE_CHILD_PROCESS_SERVER !== "1"
  ) {
    const actionPort = Number(process.env.PORT || 3000);
    try {
      await waitForReady(actionPort, 20000);
      logLine("globalSetup: Actions server ready on port", actionPort);
      serverDetected = true;
    } catch {
      try {
        await waitForPort(actionPort, 20000);
        logLine("globalSetup: Actions port open on", actionPort);
        serverDetected = true;
      } catch {
        logLine("globalSetup: Actions server not detected on", actionPort);
      }
    }
  }
  if (
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.USE_CHILD_PROCESS_SERVER === "1"
  ) {
    logLine(
      "globalSetup: Actions + USE_CHILD_PROCESS_SERVER=1; will spawn local child"
    );
  }

  // Resolve API key (env -> file -> fallback)
  let secretPlain = process.env.WEBHOOK_API_KEY || "";
  if (!secretPlain && fs.existsSync(secretFilePath)) {
    try {
      secretPlain = fs.readFileSync(secretFilePath, "utf8").trim();
      logLine(
        "globalSetup: read secret from file len=",
        String(secretPlain.length)
      );
    } catch (e) {
      logLine("globalSetup: reading secret file failed:", e.message);
    }
  }
  if (!secretPlain) {
    secretPlain = "test123";
    logLine("globalSetup: using default test API key");
  }

  // If a server is already up, don't spawn another
  const port = Number(process.env.PORT || 3000);
  try {
    await waitForReady(port, 5000);
    logLine("globalSetup: remote server /ready on", port);
    try {
      logStream.end();
    } catch {}
    return;
  } catch {
    try {
      await waitForPort(port, 5000);
      logLine("globalSetup: remote server TCP open on", port);
      try {
        logStream.end();
      } catch {}
      return;
    } catch {
      logLine("globalSetup: no server on", port, "- will spawn child");
    }
  }

  // Spawn server locally
  const nodeCmd =
    process.execPath || (process.platform === "win32" ? "node.exe" : "node");
  const serverFile = path.join(webhookDir, "server.js");

  let child;
  try {
    logLine("globalSetup: spawning", nodeCmd, serverFile);
    const spawnOptions = {
      cwd: webhookDir,
      env: { ...process.env, WEBHOOK_API_KEY: secretPlain, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    };
    if (process.env.GITHUB_ACTIONS === "true") {
      logLine(
        "globalSetup: Actions: spawn stdio ignored to avoid lingering pipes"
      );
      spawnOptions.stdio = ["ignore", "ignore", "ignore"];
    }
    child = spawn(nodeCmd, [serverFile], spawnOptions);
  } catch (e) {
    logLine("globalSetup: spawn failed:", e.message);
  }

  if (child && child.pid) {
    try {
      try {
        fs.writeFileSync(pidFilePath, String(child.pid), "utf8");
        logLine("globalSetup: wrote pid", child.pid, "to", pidFilePath);
      } catch (e) {
        logLine("globalSetup: write pid failed:", e && e.message);
      }

      try {
        fs.writeFileSync(portFilePath, String(port), "utf8");
        logLine("globalSetup: wrote port", port, "to", portFilePath);
      } catch (e) {
        logLine("globalSetup: write port failed:", e && e.message);
      }

      // Pipe child logs if available
      try {
        const repoServerLog = path.resolve(repoRoot, "server.log");
        const serverLogStream = fs.createWriteStream(repoServerLog, {
          flags: "a",
        });
        const stdoutStream = fs.createWriteStream(childStdoutPath, {
          flags: "a",
        });
        const stderrStream = fs.createWriteStream(childStderrPath, {
          flags: "a",
        });
        if (child.stdout) {
          child.stdout.pipe(serverLogStream);
          child.stdout.pipe(stdoutStream);
        }
        if (child.stderr) {
          child.stderr.pipe(serverLogStream);
          child.stderr.pipe(stderrStream);
        }
        child.on("exit", (code, signal) => {
          logLine("globalSetup: child exited code=", code, "signal=", signal);
          try {
            stdoutStream.end();
            stderrStream.end();
          } catch {}
        });
      } catch (e) {
        logLine("globalSetup: piping child stdio failed:", e && e.message);
      }

      try {
        if (typeof child.unref === "function") child.unref();
      } catch {}

      try {
        await waitForReady(port, 30000);
        logLine("globalSetup: child server /ready on", port);
      } catch {
        try {
          await waitForPort(port, 30000);
          logLine("globalSetup: child server TCP open on", port);
        } catch (e2) {
          logLine("globalSetup: child did not open port in time");
          try {
            if (typeof child.kill === "function") child.kill("SIGTERM");
          } catch {}
          throw e2;
        }
      }
    } catch (err) {
      logLine("globalSetup: failed waiting for child:", err && err.message);
      throw err;
    }
  }

  // Spawn prompt-mock child unless PROMPT_URL already points elsewhere
  try {
    const promptPidFile = path.resolve(__dirname, "prompt-mock.pid");
    const promptInfoFile = path.resolve(__dirname, "prompt-mock.json");
    const promptPort = Number(process.env.PROMPT_MOCK_PORT || 3001);
    const promptScript = path.join(__dirname, "prompt-mock-child.js");

    if (
      !process.env.PROMPT_URL ||
      process.env.PROMPT_URL === "http://127.0.0.1:3000"
    ) {
      logLine("globalSetup: spawning prompt-mock on", promptPort);
      const spawnOpts = {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: String(promptPort),
          PROMPT_MOCK_PORT: String(promptPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
      };
      const p = spawn(nodeCmd, [promptScript], spawnOpts);
      try {
        if (p && p.stdout) {
          p.stdout.pipe(
            fs.createWriteStream(
              path.resolve(__dirname, "prompt-mock.child.stdout.log"),
              { flags: "a" }
            )
          );
        }
        if (p && p.stderr) {
          p.stderr.pipe(
            fs.createWriteStream(
              path.resolve(__dirname, "prompt-mock.child.stderr.log"),
              { flags: "a" }
            )
          );
        }
      } catch (e) {
        logLine(
          "globalSetup: piping prompt-mock stdio failed:",
          e && e.message
        );
      }
      if (p && p.pid) {
        try {
          fs.writeFileSync(promptPidFile, String(p.pid), "utf8");
        } catch {}
        try {
          if (typeof p.unref === "function") p.unref();
        } catch {}
        logLine("globalSetup: prompt-mock pid=", p.pid);
        try {
          await waitForPort(promptPort, 5000);
          const url = `http://127.0.0.1:${promptPort}`;
          try {
            const tmp = `${promptInfoFile}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ url }), "utf8");
            try {
              fs.renameSync(tmp, promptInfoFile);
            } catch {
              fs.writeFileSync(promptInfoFile, JSON.stringify({ url }), "utf8");
            }
          } catch (e) {
            logLine("globalSetup: writing prompt info failed:", e && e.message);
          }
          try {
            process.env.PROMPT_URL = url;
          } catch {}
          logLine("globalSetup: prompt-mock ready at", url);
        } catch (e) {
          logLine(
            "globalSetup: prompt-mock did not open port:",
            e && e.message
          );
        }
      }
    } else {
      try {
        fs.writeFileSync(
          promptInfoFile,
          JSON.stringify({ url: process.env.PROMPT_URL }),
          "utf8"
        );
      } catch {}
    }
  } catch (e) {
    logLine("globalSetup: prompt-mock setup failed:", e && e.message);
  }

  // Close our log stream (teardown writes synchronously)
  try {
    logStream.end();
  } catch {}
};
