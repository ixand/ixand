// Rebuilds the generated blocks of README.md from the GitHub API:
//   - traffic of the public, non-fork repositories (views and clones), accumulated day by day in data/traffic.json,
//     because the API itself only keeps the last 14 days;
//   - a few numbers about the account (repositories, followers, languages by code size).
// Needs GH_TOKEN. Traffic needs a token that may read repository traffic (see README of this repo);
// without that permission the traffic block says so instead of failing the run.
import { readFile, writeFile } from 'node:fs/promises';

const OWNER = process.env.PROFILE_OWNER ?? 'ixand';
const TOKEN = process.env.GH_TOKEN;
const README = new URL('../README.md', import.meta.url);
const STORE = new URL('../data/traffic.json', import.meta.url);
if (!TOKEN) throw new Error('GH_TOKEN is not set');

async function api(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'profile-readme-updater',
    },
  });
  return { status: response.status, body: response.ok ? await response.json() : null };
}

function replaceBlock(text, name, content) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from === -1 || to === -1 || to < from) throw new Error(`README has no ${name} block`);
  return `${text.slice(0, from + start.length)}\n${content}\n${text.slice(to)}`;
}

const user = (await api(`/users/${OWNER}`)).body;
if (!user) throw new Error(`cannot read the profile of ${OWNER}`);
const repos = ((await api(`/users/${OWNER}/repos?per_page=100&type=owner&sort=pushed`)).body ?? []).filter(
  (repo) => !repo.fork && !repo.private && !repo.archived,
);

// --- traffic -------------------------------------------------------------------------------------------------
const store = JSON.parse(await readFile(STORE, 'utf8').catch(() => '{"since":null,"repos":{}}'));
let denied = 0;
for (const repo of repos) {
  const [views, clones] = await Promise.all([
    api(`/repos/${OWNER}/${repo.name}/traffic/views`),
    api(`/repos/${OWNER}/${repo.name}/traffic/clones`),
  ]);
  if (!views.body || !clones.body) {
    denied++;
    continue;
  }
  const days = (store.repos[repo.name] ??= {});
  for (const day of views.body.views) {
    const key = day.timestamp.slice(0, 10);
    days[key] = { ...days[key], views: day.count, visitors: day.uniques };
  }
  for (const day of clones.body.clones) {
    const key = day.timestamp.slice(0, 10);
    days[key] = { ...days[key], clones: day.count };
  }
}
const allDays = Object.values(store.repos).flatMap((days) => Object.keys(days)).sort();
store.since = allDays[0] ?? store.since;
await writeFile(STORE, `${JSON.stringify(store, null, 2)}\n`);

const today = new Date().toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
const sum = (days, field, from) =>
  Object.entries(days).reduce((total, [day, value]) => total + (day >= from ? (value[field] ?? 0) : 0), 0);
const rows = Object.entries(store.repos)
  .filter(([name]) => repos.some((repo) => repo.name === name))
  .map(([name, days]) => ({
    name,
    views14: sum(days, 'views', cutoff),
    visitors14: sum(days, 'visitors', cutoff),
    clones14: sum(days, 'clones', cutoff),
    viewsAll: sum(days, 'views', ''),
    clonesAll: sum(days, 'clones', ''),
  }))
  .filter((row) => row.viewsAll + row.clonesAll > 0)
  .sort((a, b) => b.views14 - a.views14 || b.clones14 - a.clones14 || b.viewsAll - a.viewsAll);
const shown = rows.slice(0, 8);

// null keeps the block as it is: without the permission there is nothing new to say, and a fresh date would lie.
let traffic = null;
if (denied > 0 && rows.length > 0) {
  console.log('traffic denied for this token: the traffic block is left unchanged');
} else if (rows.length === 0 && denied > 0) {
  traffic = '_Traffic is not available yet: the workflow token cannot read repository traffic._';
} else if (rows.length === 0) {
  traffic = '_No repository visits recorded yet._';
} else {
  const total = (field) => rows.reduce((value, row) => value + row[field], 0);
  traffic = [
    '| Repository | Views, 14 days | Daily visitors, 14 days | Clones, 14 days | Views since tracking | Clones since tracking |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...shown.map(
      (row) =>
        `| [${row.name}](https://github.com/${OWNER}/${row.name}) | ${row.views14} | ${row.visitors14} | ${row.clones14} | ${row.viewsAll} | ${row.clonesAll} |`,
    ),
    `| **Total${rows.length > shown.length ? `, all ${rows.length} repositories` : ''}** | **${total('views14')}** | **${total('visitors14')}** | **${total('clones14')}** | **${total('viewsAll')}** | **${total('clonesAll')}** |`,
    '',
    `<sub>Source: GitHub traffic API. "Daily visitors" adds up each day's unique visitors, so one person on two days counts twice. Tracking since ${store.since}; updated ${today}.</sub>`,
  ].join('\n');
}

// --- account numbers -----------------------------------------------------------------------------------------
const bytes = new Map();
for (const repo of repos) {
  const languages = (await api(`/repos/${OWNER}/${repo.name}/languages`)).body ?? {};
  for (const [language, size] of Object.entries(languages)) bytes.set(language, (bytes.get(language) ?? 0) + size);
}
const allBytes = [...bytes.values()].reduce((a, b) => a + b, 0);
const top = [...bytes]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6)
  .map(([language, size]) => `${language} ${Math.round((size / allBytes) * 100)}%`);
const stars = repos.reduce((value, repo) => value + repo.stargazers_count, 0);
const numbers = [
  `- **${repos.length}** public repositories of my own, **${stars}** ${stars === 1 ? 'star' : 'stars'}, **${user.followers}** followers`,
  `- Code by size across them: ${top.join(' · ')}`,
  `- On GitHub since ${new Date(user.created_at).getFullYear()}`,
].join('\n');

let readme = await readFile(README, 'utf8');
if (traffic !== null) readme = replaceBlock(readme, 'traffic', traffic);
readme = replaceBlock(readme, 'numbers', numbers);
await writeFile(README, readme);
console.log(`repositories: ${repos.length}, with traffic: ${rows.length}, traffic denied: ${denied}`);
