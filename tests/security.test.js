import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApi } from "../core.js";

test("Spotify requests refuse redirects before sending credentials to a second endpoint", async (t) => {
  let redirectedRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(307, { Location: "/destination" });
      response.end();
    } else {
      redirectedRequests++;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const localUrl = `http://127.0.0.1:${server.address().port}/redirect`;
  const api = createApi(
    async () => "test-token",
    (_, options) => fetch(localUrl, options),
  );
  await assert.rejects(() => api("me"), /fetch failed/);
  assert.equal(redirectedRequests, 0);
});
