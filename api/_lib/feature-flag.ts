export function isAskAhmadEnabled(): boolean {
  return process.env.ASK_AHMAD_ENABLED === 'true';
}

export function disabledResponse(): Response {
  return new Response(
    JSON.stringify({ error: 'feature_disabled', message: 'Ask Ahmad is not enabled in this environment.' }),
    { status: 503, headers: { 'content-type': 'application/json' } }
  );
}
