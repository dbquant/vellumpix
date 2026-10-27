#!/usr/bin/env node

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  argumentsByName.set(process.argv[index], process.argv[index + 1]);
}

const host = argumentsByName.get("--host") ?? "127.0.0.1";
const port = Number(argumentsByName.get("--port"));

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Usage: node inspect-browser-windows.mjs --host <host> --port <port>");
  process.exitCode = 2;
} else {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const [versionResponse, targetsResponse] = await Promise.all([
      fetch(`http://${host}:${port}/json/version`, { signal: controller.signal }),
      fetch(`http://${host}:${port}/json/list`, { signal: controller.signal }),
    ]).finally(() => clearTimeout(timeout));

    if (!versionResponse.ok || !targetsResponse.ok) {
      throw new Error(
        `DevTools HTTP error: version=${versionResponse.status}, targets=${targetsResponse.status}`,
      );
    }

    const version = await versionResponse.json();
    const listedTargets = await targetsResponse.json();
    const endpoint = new URL(version.webSocketDebuggerUrl);
    endpoint.hostname = host;
    endpoint.port = String(port);

    const socket = new WebSocket(endpoint);
    const pending = new Map();
    let nextId = 1;
    const opened = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out opening the browser WebSocket")),
        5_000,
      );
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Failed to open the browser WebSocket"));
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });

    await opened;
    const send = (method, params) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}`));
        }, 5_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });

    try {
      const pageTargets = listedTargets.filter((target) => target.type === "page");
      const targets = [];
      for (const target of pageTargets) {
        const { windowId } = await send("Browser.getWindowForTarget", { targetId: target.id });
        targets.push({
          targetId: target.id,
          windowId,
          url: target.url,
          title: target.title,
        });
      }
      console.log(JSON.stringify({ available: true, host, port, targets }));
    } finally {
      socket.close();
    }
  } catch (error) {
    console.log(
      JSON.stringify({
        available: false,
        host,
        port,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
