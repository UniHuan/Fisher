#!/usr/bin/env node
// Dependency-free local load smoke test. It is not a replacement for k6 in staging.
//
// Usage:
//   BASE_URL=http://127.0.0.1:3012 node scripts/perf/load-test.mjs \
//     --scenario=list --duration=10 --concurrency=20

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);

const baseUrl = (args.get('base-url') ?? process.env.BASE_URL ?? 'http://127.0.0.1:3012').replace(
  /\/$/,
  '',
);
const scenario = args.get('scenario') ?? 'list';
const durationSeconds = Number(args.get('duration') ?? 10);
const concurrency = Number(args.get('concurrency') ?? 20);
const headers = {
  'X-Client-Type': 'miniprogram',
  'X-Client-Version': '1.0.0',
  'User-Agent': 'szfisher-load-smoke/1.0.0',
};

if (!['list', 'detail', 'search'].includes(scenario)) {
  throw new Error('--scenario must be list, detail or search');
}
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  throw new Error('--duration must be a positive number');
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) {
  throw new Error('--concurrency must be between 1 and 200');
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  await response.arrayBuffer();
  return response;
}

let spotId = args.get('spot-id') ?? '';
if (scenario === 'detail' && spotId === '') {
  const result = await fetch(`${baseUrl}/api/v1/spots?page=1&page_size=1`, { headers });
  const payload = await result.json();
  spotId = payload?.data?.items?.[0]?.spot_id ?? '';
  if (spotId === '') {
    throw new Error('No published spot is available for detail load test');
  }
}

function targetUrl() {
  if (scenario === 'detail') {
    return `${baseUrl}/api/v1/spots/${encodeURIComponent(spotId)}`;
  }
  if (scenario === 'search') {
    return `${baseUrl}/api/v1/spots?keyword=PERF-&page=1&page_size=20`;
  }
  return `${baseUrl}/api/v1/spots?page=1&page_size=20`;
}

const latencies = [];
let errors = 0;
const deadline = Date.now() + durationSeconds * 1000;

async function worker() {
  while (Date.now() < deadline) {
    const started = performance.now();
    try {
      const response = await fetchText(targetUrl());
      if (!response.ok) {
        errors += 1;
      }
    } catch {
      errors += 1;
    } finally {
      latencies.push(performance.now() - started);
    }
  }
}

// One short warmup request avoids counting lazy database and DNS setup.
try {
  await fetchText(targetUrl());
} catch {
  // The measured window will report persistent failures.
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
latencies.sort((left, right) => left - right);
const percentile = (value) => {
  if (latencies.length === 0) {
    return 0;
  }
  const index = Math.min(latencies.length - 1, Math.ceil(value * latencies.length) - 1);
  return Number(latencies[index].toFixed(2));
};
const total = latencies.length;
const summary = {
  scenario,
  base_url: baseUrl,
  duration_s: durationSeconds,
  concurrency,
  requests: total,
  rps: Number((total / durationSeconds).toFixed(1)),
  errors,
  error_rate: total === 0 ? 1 : Number((errors / total).toFixed(4)),
  p50_ms: percentile(0.5),
  p95_ms: percentile(0.95),
  p99_ms: percentile(0.99),
  max_ms: total === 0 ? 0 : Number(latencies[total - 1].toFixed(2)),
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (errors > 0 && args.has('fail-on-error')) {
  process.exitCode = 1;
}
