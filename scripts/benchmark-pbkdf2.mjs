import { createServer } from "node:http";
import { arch, cpus, platform, release } from "node:os";

import { chromium, devices } from "@playwright/test";

const iterations = Number.parseInt(
  process.env.PBKDF2_ITERATIONS ?? "600000",
  10
);
const samples = Number.parseInt(process.env.PBKDF2_SAMPLES ?? "3", 10);

if (!Number.isSafeInteger(iterations) || iterations <= 0) {
  throw new Error("PBKDF2_ITERATIONS must be a positive safe integer.");
}
if (!Number.isSafeInteger(samples) || samples <= 0) {
  throw new Error("PBKDF2_SAMPLES must be a positive safe integer.");
}

const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end("<!doctype html><meta charset=utf-8><title>PBKDF2 benchmark</title>");
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  server.close();
  throw new Error("Failed to start the local benchmark server.");
}

const browser = await chromium.launch();
console.log(
  JSON.stringify({
    benchmark: "PBKDF2-SHA-256 deriveBits(256)",
    browserVersion: browser.version(),
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
  })
);
const scenarios = [
  { name: "chromium-desktop", options: {} },
  {
    name: "chromium-mobile-emulation",
    options: devices["Pixel 7"],
  },
];

try {
  for (const scenario of scenarios) {
    const context = await browser.newContext(scenario.options);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const result = await page.evaluate(
      async ({ benchmarkIterations, benchmarkSamples }) => {
        const password = new TextEncoder().encode("phase2-benchmark-passphrase");
        const salt = new Uint8Array(16);
        crypto.getRandomValues(salt);
        const key = await crypto.subtle.importKey(
          "raw",
          password,
          "PBKDF2",
          false,
          ["deriveBits"]
        );
        const durations = [];
        for (let index = 0; index < benchmarkSamples; index += 1) {
          const startedAt = performance.now();
          await crypto.subtle.deriveBits(
            {
              name: "PBKDF2",
              hash: "SHA-256",
              salt,
              iterations: benchmarkIterations,
            },
            key,
            256
          );
          durations.push(performance.now() - startedAt);
        }
        return {
          secureContext: window.isSecureContext,
          durations,
        };
      },
      {
        benchmarkIterations: iterations,
        benchmarkSamples: samples,
      }
    );
    const total = result.durations.reduce((sum, value) => sum + value, 0);
    console.log(
      JSON.stringify({
        scenario: scenario.name,
        iterations,
        samples,
        secureContext: result.secureContext,
        averageMs: Math.round((total / result.durations.length) * 10) / 10,
        minMs: Math.round(Math.min(...result.durations) * 10) / 10,
        maxMs: Math.round(Math.max(...result.durations) * 10) / 10,
      })
    );
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
