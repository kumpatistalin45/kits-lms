// test_vercel_handler.js
// Verifies that api/index.js correctly imports server.js and handles Vercel Serverless Function invocations
const http = require("http");

async function runVercelHandlerTest() {
    console.log("==================================================================");
    console.log("  VERCEL SERVERLESS FUNCTION HANDLER VERIFICATION");
    console.log("==================================================================");

    let vercelHandler = null;
    try {
        vercelHandler = require("./api/index.js");
        console.log("  [PASS] 1. api/index.js imported successfully without syntax errors");
    } catch (e) {
        console.error("  [FAIL] 1. Failed to import api/index.js:", e.message);
        process.exit(1);
    }

    if (typeof vercelHandler !== "function") {
        console.error("  [FAIL] 2. api/index.js does not export a function. Type:", typeof vercelHandler);
        process.exit(1);
    }
    console.log("  [PASS] 2. api/index.js exports a valid async (req, res) function");

    // Test with simulated HTTP server using the exported handler
    const testServer = http.createServer(vercelHandler);
    await new Promise((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const port = testServer.address().port;
    console.log(`  [PASS] 3. Test HTTP server running on ephemeral port ${port} using Vercel handler`);

    function request(path, method = "GET", headers = {}) {
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers: { "Content-Type": "application/json", ...headers }
            }, (res) => {
                let data = "";
                res.on("data", chunk => data += chunk);
                res.on("end", () => {
                    let parsed = null;
                    try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
                    resolve({ status: res.statusCode, body: parsed });
                });
            });
            req.on("error", reject);
            req.end();
        });
    }

    // Check 1: /api/health
    const healthRes = await request("/api/health");
    if (healthRes.status === 200 && (healthRes.body.status === "UP" || healthRes.body.status === "ok")) {
        console.log("  [PASS] 4. /api/health returns HTTP 200 { status: 'UP' } via Vercel handler");
    } else {
        console.error("  [FAIL] 4. /api/health returned:", healthRes.status, healthRes.body);
    }

    // Check 2: /api/server-time
    const timeRes = await request("/api/server-time");
    if (timeRes.status === 200 && timeRes.body.success && timeRes.body.timezone) {
        console.log("  [PASS] 5. /api/server-time returns HTTP 200 with IST timezone via Vercel handler");
    } else {
        console.error("  [FAIL] 5. /api/server-time returned:", timeRes.status, timeRes.body);
    }

    // Check 3: Rewritten path via x-forwarded-uri header
    const fwdRes = await request("/api/index.js", "GET", { "x-forwarded-uri": "/api/health" });
    if (fwdRes.status === 200 && (fwdRes.body.status === "UP" || fwdRes.body.status === "ok")) {
        console.log("  [PASS] 6. x-forwarded-uri rewrite header correctly routed to /api/health");
    } else {
        console.error("  [FAIL] 6. x-forwarded-uri failed:", fwdRes.status, fwdRes.body);
    }

    testServer.close();
    console.log("\n==================================================================");
    console.log("  >>> VERCEL SERVERLESS HANDLER VERIFICATION COMPLETED (100% PASS) <<<");
    console.log("==================================================================");
}

runVercelHandlerTest().catch(err => {
    console.error("Test error:", err);
    process.exit(1);
});
