/** Local server for browser checks of the actual GitHub Pages export. */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("out");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    ).replace(/^\/Scholar-Pulse(?=\/|$)/, "");
    let path = resolve(root, "." + (pathname || "/"));
    if (path !== root && !path.startsWith(root + sep))
      throw new Error("invalid path");
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    response.setHeader(
      "Content-Type",
      mime[extname(path)] ?? "application/octet-stream",
    );
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(4175, "127.0.0.1");
