/**
 * 极简本地共享服务（静态页面托管 + 试点状态共享接口）
 * ponytail: 零依赖原生 Node HTTP 服务，用于多端/多账号共享任务与进度，后续可平滑替换为正式后端 API。
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const STATE_FILE = path.join(ROOT_DIR, ".pilot-state.json");
const PORT = Number(process.env.PORT || 8787);

const MIME_MAP = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

/** 读取服务端持久化状态 */
function readServerState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/** 写入服务端持久化状态 */
function writeServerState(payload) {
  const tmpFile = STATE_FILE + ".tmp";
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpFile, STATE_FILE);
}

/** 发送 JSON 响应 */
function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const reqPath = (req.url || "/").split("?")[0];

  if (reqPath === "/api/pilot-state" && req.method === "GET") {
    const state = readServerState();
    sendJson(res, 200, { initialized: Boolean(state), state });
    return;
  }

  if (reqPath === "/api/pilot-state" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        parsed.serverUpdatedAt = Date.now();
        writeServerState(parsed);
        sendJson(res, 200, { ok: true, serverUpdatedAt: parsed.serverUpdatedAt });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: "Invalid JSON payload" });
      }
    });
    return;
  }

  if (reqPath === "/api/pilot-reset" && req.method === "POST") {
    try {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    } catch (_) {}
    sendJson(res, 200, { ok: true });
    return;
  }

  // 静态文件托管（防止路径穿越，只服务允许的前端资源）
  const safeRel = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
  const resolved = path.normalize(path.join(ROOT_DIR, safeRel));
  if (!resolved.startsWith(ROOT_DIR) || safeRel.startsWith(".")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolved, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_MAP[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MINISO pilot server listening on http://127.0.0.1:${PORT}`);
});
