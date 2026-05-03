// Ingestion pipeline for Ask Ahmad.
//
// Pulls content from three sources, chunks semantically, embeds, and upserts
// into Neon Postgres + pgvector.
//
//   1. WordPress articles via REST API (PUBLIC_WP_URL/wp-json/wp/v2/posts)
//   2. Portfolio MDX/JSON files in frontend/src/content/
//   3. content/voice-pack.yaml
//
// Run:
//   npm run ingest          # incremental (only new/updated content)
//   npm run ingest -- --full  # re-embed everything
//
// Triggered by: WordPress publish webhook + nightly cron + manual.
//
// This file is a stub. The full implementation lands once Neon and Upstash
// are provisioned and the API keys are in place.

const FULL = process.argv.includes('--full');

async function main() {
  console.log('[ingest] Ask Ahmad ingestion');
  console.log('[ingest] mode:', FULL ? 'full re-embed' : 'incremental');
  console.log('[ingest] sources:');
  console.log('  - WordPress: ' + (process.env.PUBLIC_WP_URL ?? '(missing PUBLIC_WP_URL)'));
  console.log('  - Portfolio: frontend/src/content/');
  console.log('  - Voice Pack: content/voice-pack.yaml');
  console.log('');
  console.log('[ingest] not yet wired. Provision Neon + drop ANTHROPIC_API_KEY + VOYAGE_API_KEY first.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[ingest] failed:', err);
  process.exit(1);
});
