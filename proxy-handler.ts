// Standalone RCON proxy handler — accepts an HTTP POST with arbitrary
// RCON credentials + command, opens a short-lived ws:// connection,
// sends the command, resolves with the response, then closes.

import WebSocket from "ws";

const RCON_PROXY_SECRET = process.env.RCON_PROXY_SECRET || process.env.ENGINE_BRIDGE_TOKEN || "";

export interface RconProxyRequest {
  secret: string;
  ip: string;
  port: string | number;
  password: string;
  command: string;
  timeoutMs?: number;
}

function sendOneOffRcon(
  ip: string,
  port: string | number,
  password: string,
  command: string,
  timeoutMs = 12_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `ws://${ip}:${port}/${encodeURIComponent(password)}`;
    let settled = false;
    const identifier = Math.floor(Math.random() * 1_000_000);

    const done = (fn: (v: string | Error) => void, val: string | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      fn(val);
    };

    const timer = setTimeout(() => {
      done(reject, new Error("RCON connection timed out after " + timeoutMs + "ms"));
    }, timeoutMs);

    const ws = new WebSocket(url);

    ws.on("open", () => {
      ws.send(JSON.stringify({ Identifier: identifier, Message: command, Name: "RustysProxy" }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.Identifier === identifier || msg.Identifier === 0) {
          done(resolve, msg.Message || "OK");
        }
      } catch {
        done(resolve, String(raw));
      }
    });

    ws.on("error", (e: Error) => done(reject, new Error("WebSocket error: " + e.message)));
    ws.on("close", (code: number, reason: Buffer) => {
      if (!settled) done(reject, new Error(`Connection closed: ${code} ${reason?.toString() || ""}`));
    });
  });
}

export async function handleRconProxy(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse,
): Promise<void> {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.writeHead(405).end(JSON.stringify({ success: false, error: "Method not allowed" }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const bodyStr = Buffer.concat(chunks).toString("utf-8");

  let body: RconProxyRequest;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    res.writeHead(400).end(JSON.stringify({ success: false, error: "Invalid JSON body" }));
    return;
  }

  const { secret, ip, port, password, command, timeoutMs } = body;

  if (!RCON_PROXY_SECRET || secret !== RCON_PROXY_SECRET) {
    res.writeHead(401).end(JSON.stringify({ success: false, error: "Unauthorized" }));
    return;
  }

  if (!ip || !port || !password || !command) {
    res.writeHead(400).end(JSON.stringify({
      success: false,
      error: "Missing required fields: ip, port, password, command",
    }));
    return;
  }

  try {
    const response = await sendOneOffRcon(ip, String(port), password, command, timeoutMs || 12_000);
    res.writeHead(200).end(JSON.stringify({ success: true, response }));
  } catch (err) {
    res.writeHead(200).end(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}
