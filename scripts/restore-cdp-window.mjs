async function call(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", listener);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    ws.addEventListener("message", listener);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("CDP has no page target");
const version = await (await fetch("http://127.0.0.1:9222/json/version")).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const windowInfo = await call(ws, 1, "Browser.getWindowForTarget", { targetId: page.id });
await call(ws, 2, "Browser.setWindowBounds", {
  windowId: windowInfo.windowId,
  bounds: { windowState: "normal" }
});
await call(ws, 3, "Browser.setWindowBounds", {
  windowId: windowInfo.windowId,
  bounds: { left: 80, top: 60, width: 1440, height: 900 }
});
await call(ws, 4, "Target.activateTarget", { targetId: page.id });
console.log(`WINDOW_RESTORED ${windowInfo.windowId}`);
ws.close();
