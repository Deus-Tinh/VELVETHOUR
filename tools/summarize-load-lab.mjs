import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('../docs/load-lab/', import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(name, directory), 'utf8'));
const metrics = [];
for (const phase of ['before', 'after']) {
  for (const endpoint of ['static', 'services']) {
    const base = `${phase}-${endpoint}`;
    const raw = await readJson(`${base}.json`);
    const metadata = await readJson(`${base}-metadata.json`);
    const lines = (await readFile(new URL(`${base}-monitor.csv`, directory), 'utf8')).trim().split(/\r?\n/);
    const parse = (line) => line.split(',').map((value) => value.replace(/^"|"$/g, ''));
    const columns = parse(lines[0].replace(/^\uFEFF/, ''));
    const samples = lines.slice(1).map((line) => Object.fromEntries(parse(line).map((value, i) => [columns[i], i === 1 ? value : Number(value)])));
    let previous = 0, cpuMachine = 0, cpuCore = 0;
    for (const sample of samples) {
      const interval = sample.Elapsed_s - previous;
      cpuMachine += sample.CPU_machine_pct * interval;
      cpuCore += sample.CPU_one_core_pct * interval;
      previous = sample.Elapsed_s;
    }
    const counts = raw.statusCodeDistribution;
    const responses = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const networkErrors = Object.values(raw.errorDistribution).reduce((sum, count) => sum + count, 0);
    const serverErrors = Object.entries(counts).filter(([status]) => Number(status) >= 500).reduce((sum, [, count]) => sum + count, 0);
    metrics.push({ phase, endpoint: metadata.Endpoint, seconds: raw.summary.total, responses,
      accepted200: counts['200'] || 0, blocked429: counts['429'] || 0, networkErrors, serverErrors,
      httpRps: responses / raw.summary.total, acceptedRps: (counts['200'] || 0) / raw.summary.total,
      p95Ms: raw.metrics.latency_ms.p95, p99Ms: raw.metrics.latency_ms.p99,
      blockPct: 100 * (counts['429'] || 0) / Math.max(1, responses),
      errorPct: 100 * (networkErrors + serverErrors) / Math.max(1, responses + networkErrors),
      cpuMachinePct: cpuMachine / previous, cpuOneCorePct: cpuCore / previous,
      peakRamMb: Math.max(...samples.map((sample) => sample.RAM_MB)),
      peakConnections: Math.max(...samples.map((sample) => sample.Established_connections)),
      monitorSamples: samples.length, metadata,
    });
  }
}
await writeFile(new URL('summary.json', directory), JSON.stringify(metrics, null, 2) + '\n');
const number = (value) => value.toFixed(2);
const table = [
  '| Lượt | Endpoint | HTTP/s tổng | HTTP 200/s | p95 ms | p99 ms | 429 % | Lỗi mạng + 5xx % | CPU máy % | CPU một lõi % | RAM đỉnh MB | Kết nối đỉnh |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...metrics.map((row) => `| ${row.phase} | \`${row.endpoint}\` | ${number(row.httpRps)} | ${number(row.acceptedRps)} | ${number(row.p95Ms)} | ${number(row.p99Ms)} | ${number(row.blockPct)} | ${number(row.errorPct)} | ${number(row.cpuMachinePct)} | ${number(row.cpuOneCorePct)} | ${number(row.peakRamMb)} | ${row.peakConnections} |`),
].join('\n');
console.log(table);
