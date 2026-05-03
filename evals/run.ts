// Ask Ahmad eval runner.
//
// Reads evals/golden-set.yaml, sends each question through the API, scores
// with Claude Haiku 4.5 as judge against a rubric, writes evals/results.json.
// CI gate: failures below threshold block merge.
//
// Run:
//   npm run evals          # run against local dev API
//   npm run evals -- --url=https://ask-ahmad-preview.vercel.app
//
// This file is a stub. The full implementation lands once the chat endpoint
// is wired and ANTHROPIC_API_KEY is in place.

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

async function main() {
  console.log('[evals] Ask Ahmad eval runner');
  console.log('[evals] target:', args.url ?? 'http://localhost:3000/api/ask-ahmad');
  console.log('[evals] not yet wired. Wire chat endpoint + ANTHROPIC_API_KEY first.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[evals] failed:', err);
  process.exit(1);
});
