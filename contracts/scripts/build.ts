/**
 * Compile src/**.sol with solc-js (WASM, no native binaries) into
 * artifacts/<Contract>.json = { abi, bytecode }. Same settings as foundry.toml.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error solc has no types
import solc from 'solc';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const outDir = join(root, 'artifacts');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.sol') ? [p] : [];
  });
}

const sources: Record<string, { content: string }> = {};
for (const file of walk(srcDir)) {
  sources[relative(srcDir, file).split(sep).join('/')] = { content: readFileSync(file, 'utf8') };
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    evmVersion: 'shanghai',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors ?? []).filter((e: { severity: string }) => e.severity === 'error');
for (const e of output.errors ?? []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);

mkdirSync(outDir, { recursive: true });
for (const [file, contracts] of Object.entries<Record<string, { abi: unknown; evm: { bytecode: { object: string } } }>>(
  output.contracts,
)) {
  for (const [name, c] of Object.entries(contracts)) {
    if (!c.evm.bytecode.object) continue; // interfaces / abstract
    writeFileSync(
      join(outDir, `${name}.json`),
      JSON.stringify({ contractName: name, sourceName: file, abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, null, 2),
    );
  }
}
console.log(`compiled ${Object.keys(sources).length} files with solc ${solc.version()}`);
