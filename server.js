// Rust RCON WebSocket Proxy — Bun runtime
// Uses Bun.serve + native WebSocket
/* eslint-disable */

const SECRET = process.env.PROXY_SECRET || "changeme";
const PORT = process.env.PORT || 8080;

function sendRcon(ip, port, password, command) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      fn(val);
    };

    const timeout = setTimeout(() => {
      done(reject, new Error("RCON connection timed out after 12s"));
    }, 12000);

    const wsUrl = `ws://${ip}:${port}/${encodeURIComponent(password)}`;
    const ws = new WebSocket(wsUrl);
    const identifier = Math.floor(Math.random() * 100000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ Identifier: identifier, Message: command, Name: "RustProxy" }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.Identifier === identifier) {
          done(resolve, msg.Message || "OK");
        }
      } catch {
        done(resolve, String(event.data));
      }
    };

    ws.onerror = (e) => {
      done(reject, new Error("WebSocket error: " + (e?.message || "unknown")));
    };

    ws.onclose = (e) => {
      if (!settled) done(reject, new Error(`Connection closed: ${e.code} ${e.reason || ""}`));
    };
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(JSON.stringify({ status: "alive" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (req.method !== "POST" || url.pathname !== "/rcon") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const { secret, ip, port, password, command } = await req.json();

      if (secret !== SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!ip || !port || !password || !command) {
        return new Response(JSON.stringify({ error: "Missing required fields: ip, port, password, command" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const response = await sendRcon(ip, String(port), password, command);
      return new Response(JSON.stringify({ success: true, response }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
});

console.log(`RCON Proxy (Bun) running on port ${PORT}`);
