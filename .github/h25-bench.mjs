// Times `hook claude` of built spec-harness copies, each beside a spec-brief
// build, the pairs taking turns inside each round, with `node -e 0` and
// spec-brief's `list` alone beside them. A session starts once per pair and
// project, and every write after is a call of that session, as in Claude
// Code; the "a new session" rows start one for each run.
// usage: node h25-bench.mjs <work dir> <rounds> <out.json> <name>=<harness dir>,<spec-brief dir> ...
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cpus, totalmem } from 'node:os';
// The hook starts no Claude Code; the variables it reads are cleared, as on the workstation.
const safeEnv = (extra = {}) => {
  const env = { ...process.env };
  for (const name of ['SPEC_BRIEF', 'CLAUDE_PROJECT_DIR', 'GITHUB_HEAD_REF', 'GITHUB_REF_NAME', 'GITHUB_REF_TYPE', 'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', 'CI_COMMIT_BRANCH', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  return { ...env, ...extra };
};
const removedFromPath = () => [];

const [workArg, roundsArg, outArg, ...pairArgs] = process.argv.slice(2);
const work = resolve(workArg);
const rounds = Number(roundsArg);
const pairs = Object.fromEntries(
  pairArgs.map((arg) => {
    const name = arg.slice(0, arg.indexOf('='));
    const [harness, brief] = arg.slice(arg.indexOf('=') + 1).split(',');
    return [name, { harness: resolve(harness), brief: resolve(brief) }];
  }),
);
const node = process.execPath;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'gitconfig'), '[user]\n  email = h25@example.invalid\n  name = h25\n[core]\n  autocrlf = false\n[commit]\n  gpgsign = false\n[init]\n  defaultBranch = main\n');
const baseEnv = safeEnv({ GIT_CONFIG_GLOBAL: join(work, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const brief = (id, slug) => ['---', 'status: active', 'affectedFiles: [src/**]', 'protectedFiles: [src/db/schema.ts]', '---', '', `# ${id} - ${slug}`, '', '## Intent', '', 'Time the hook.', ''].join('\n');

function project(pair, name, branch, briefs) {
  const { harness, brief: specBrief } = pairs[pair];
  const dir = join(work, pair, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'node_modules', '@descent-vtt'), { recursive: true });
  symlinkSync(harness, join(dir, 'node_modules', '@descent-vtt', 'spec-harness'), 'junction');
  symlinkSync(specBrief, join(dir, 'node_modules', '@descent-vtt', 'spec-brief'), 'junction');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  execFileSync(node, [join(specBrief, 'bin', 'spec-brief.js'), 'init'], { cwd: dir, encoding: 'utf8', env: baseEnv });
  mkdirSync(join(dir, 'src', 'db'), { recursive: true });
  mkdirSync(join(dir, 'briefs'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src', 'db', 'schema.ts'), 'export const s = 1;\n');
  writeFileSync(join(dir, 'notes.md'), '# notes\n');
  for (let n = 0; n < briefs; n += 1) {
    const id = String(42 + n).padStart(3, '0');
    writeFileSync(join(dir, 'briefs', `${id}_bench${n}.md`), brief(id, `Bench ${n}`));
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  if (branch !== 'main') git(dir, 'checkout', '-q', '-b', branch);
  return dir;
}

const projects = Object.fromEntries(
  Object.keys(pairs).map((pair) => [
    pair,
    {
      none: project(pair, 'none', 'main', 1),
      named: project(pair, 'named', 'claude/brief-042-bench', 1),
      many: project(pair, 'many', 'claude/brief-042-bench', 60),
    },
  ]),
);
let counter = 0;
const question = (event, dir, session, file, call) =>
  JSON.stringify({
    session_id: session,
    transcript_path: join(work, 't.jsonl'),
    cwd: dir,
    permission_mode: 'default',
    hook_event_name: event,
    ...(event === 'SessionStart'
      ? { source: 'startup', model: 'claude' }
      : {
          tool_name: 'Edit',
          tool_input: { file_path: join(dir, ...file.split('/')), old_string: 'a', new_string: 'b' },
          tool_use_id: call,
          ...(event === 'PostToolUse' ? { tool_response: {} } : {}),
        }),
  });
const timed = (program, args, options) => {
  const start = process.hrtime.bigint();
  const r = spawnSync(program, args, { encoding: 'utf8', windowsHide: true, timeout: 120_000, ...options });
  if (r.error) throw r.error;
  return { ms: Number(process.hrtime.bigint() - start) / 1e6, exit: r.status, out: (r.stdout || r.stderr).slice(0, 160) };
};
const hook = (dir, input) =>
  timed(node, [join(dir, 'node_modules', '@descent-vtt', 'spec-harness', 'bin', 'spec-harness.js'), 'hook', 'claude'], { cwd: dir, input, env: { ...baseEnv, CLAUDE_PROJECT_DIR: dir } });
const list = (dir) => timed(node, [join(dir, 'node_modules', '@descent-vtt', 'spec-brief', 'bin', 'spec-brief.js'), 'list', '--archived', '--format', 'json', '--no-color'], { cwd: dir, env: { ...baseEnv, NO_COLOR: '1', FORCE_COLOR: '0' } });

// Each case: [label, project, file, what runs].
const CASES = [
  ['before an Edit, no brief named', 'none', 'src/a.ts', 'pre'],
  ["before an Edit in the scope, on a brief's branch", 'named', 'src/a.ts', 'pre'],
  ["before an Edit of a protected file, on a brief's branch", 'named', 'src/db/schema.ts', 'pre'],
  ["before an Edit in the scope, on a brief's branch, 60 briefs", 'many', 'src/a.ts', 'pre'],
  ["after an Edit outside the scope, on a brief's branch, with no run before it", 'named', 'notes.md', 'post'],
  ["as a session starts, on a brief's branch", 'named', null, 'start'],
  ["before an Edit in the scope, on a brief's branch, a new session", 'named', 'src/a.ts', 'cold'],
  ["spec-brief list alone, on a brief's branch", 'named', null, 'list'],
];
const times = {};
const said = {};
const note = (label, result) => {
  (times[label] ??= []).push(result.ms);
  said[label] ??= `exit ${result.exit}: ${result.out}`;
};
const names = Object.keys(pairs);
// A session for each pair and project, started once before the rounds.
for (const pair of names) for (const [which, dir] of Object.entries(projects[pair])) hook(dir, question('SessionStart', dir, `h25-${pair}-${which}`, null, null));
for (let round = 0; round < rounds; round += 1) {
  for (const [index, [label, which, file, kind]] of CASES.entries()) {
    const order = (round + index) % 2 === 0 ? names : [...names].reverse();
    for (const pair of order) {
      const dir = projects[pair][which];
      const session = `h25-${pair}-${which}`;
      const call = `toolu_h25_${(counter += 1)}`;
      if (kind === 'pre') note(`${pair}: ${label}`, hook(dir, question('PreToolUse', dir, session, file, call)));
      else if (kind === 'post') note(`${pair}: ${label}`, hook(dir, question('PostToolUse', dir, session, file, call)));
      else if (kind === 'start') note(`${pair}: ${label}`, hook(dir, question('SessionStart', dir, `h25-start-${counter}`, null, null)));
      else if (kind === 'cold') note(`${pair}: ${label}`, hook(dir, question('PreToolUse', dir, `h25-cold-${counter}`, file, call)));
      else note(`${pair}: ${label}`, list(dir));
    }
    note('node -e 0', timed(node, ['-e', '0'], {}));
  }
}
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
  const median = s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, median, p95: at(0.95), min: s[0], max: s[s.length - 1] };
};
const summary = Object.fromEntries(Object.entries(times).map(([label, xs]) => [label, stats(xs)]));
const result = {
  node: process.version,
  platform: process.platform,
  git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(),
  cpu: `${cpus()[0].model}, ${cpus().length} logical`,
  memoryGB: Math.round(totalmem() / 2 ** 30),
  removedFromPath: removedFromPath(),
  rounds,
  pairs,
  summary,
  said,
};
writeFileSync(resolve(outArg), JSON.stringify(result, null, 2));
const pad = (x) => x.toFixed(0).padStart(6);
console.log(`node ${result.node}, ${result.git}, ${result.cpu}, ${result.memoryGB} GB, ${rounds} rounds, ms; PATH without ${result.removedFromPath.length} directories holding claude`);
console.log('median    p95    min    max  case');
for (const [label, s] of Object.entries(summary)) console.log(`${pad(s.median)} ${pad(s.p95)} ${pad(s.min)} ${pad(s.max)}  ${label}`);
for (const [label, text] of Object.entries(said)) console.log(`said: ${label}: ${text.replace(/\n/g, ' ')}`);
