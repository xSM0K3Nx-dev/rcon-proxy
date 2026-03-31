// Rust RCON WebSocket Proxy
const http = require("http");
const { WebSocket } = require("ws");

const SECRET = process.env.PROXY_SECRET || "changeme";
const PORT = process.env.PORT || 3000;

function sendRcon(ip, port, password, command) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.terminate(); } catch {}
      fn(val);
    };
    const timeout = setTimeout(() => {
      done(reject, new Error("RCON connection timed out after 12s"));
    }, 12000);
    const ws = new WebSocket(`ws://${ip}:${port}/${password}`);
    const identifier = Math.floor(Math.random() * 100000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ Identifier: identifier, Message: command, Name: "RustProxy" }));
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.Identifier === identifier) done(resolve, msg.Message || "OK");
      } catch {}
    });
    ws.on("error", (e) => done(reject, new Error("WebSocket error: " + e.message)));
    ws.on("close", (code, reason) => {
      if (!settled) done(reject, new Error(`Connection closed: ${code} ${reason}`));
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST" || req.url !== "/rcon") {
    res.writeHead(404);
    return res.end(JSON.stringify({ error: "Not found" }));
  }
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", async () => {
    try {
      const { secret, ip, port, password, command } = JSON.parse(body);
      if (secret !== SECRET) { res.writeHead(401); return res.end(JSON.stringify({ error: "Unauthorized" })); }
      if (!ip || !port || !password || !command) { res.writeHead(400); return res.end(JSON.stringify({ error: "Missing fields" })); }
      const response = await sendRcon(ip, String(port), password, command);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, response }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  });
});

server.listen(PORT, () => console.log(`RCON Proxy running on port ${PORT}`));
