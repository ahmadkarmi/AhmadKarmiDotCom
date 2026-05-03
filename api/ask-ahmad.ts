import { isAskAhmadEnabled, disabledResponse } from './_lib/feature-flag';

export const config = {
  maxDuration: 60,
};

export default async function handler(request: Request): Promise<Response> {
  if (!isAskAhmadEnabled()) {
    return disabledResponse();
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      status: 'scaffold',
      message: 'Ask Ahmad endpoint is reachable. Wire up retrieval + LLM streaming in the next step.',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}
