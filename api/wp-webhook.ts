// WordPress publish webhook for Ask Ahmad.
//
// The MU plugin (wp-mu-plugins/trigger-vercel-deploy.php) POSTs here whenever
// an insight or work post is published, updated, unpublished, or deleted. We
// re-embed (or remove) just that one post so K.AI's vector index stays current
// without a full corpus rebuild.
//
// Node.js handler shape — see memory reference_vercel_api_handler_shape: the
// Web Standards (Request/Response) signature silently fails on Vercel's Node
// runtime.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';

import { ingestPostById, deletePostChunks } from '../scripts/lib/ingest-single';
import type { WpPostType } from '../scripts/lib/wp';

interface WebhookBody {
  reason?: string;
  postId?: number | string;
  postType?: string;
  postStatus?: string;
  postName?: string;
}

const INGEST_TYPES: WpPostType[] = ['insight', 'work'];

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const expected = process.env.WP_WEBHOOK_SECRET;
  if (!expected) {
    console.error('[wp-webhook] WP_WEBHOOK_SECRET not configured');
    res.status(500).json({ error: 'not_configured' });
    return;
  }
  const provided = req.headers['x-ak-webhook-secret'];
  const providedStr = Array.isArray(provided) ? provided[0] : provided;
  if (!providedStr || !safeEqual(providedStr, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  let body: WebhookBody;
  try {
    if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else if (req.body && typeof req.body === 'object') {
      body = req.body as WebhookBody;
    } else {
      throw new Error(`unexpected body type: ${typeof req.body}`);
    }
  } catch {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }

  const reason = String(body.reason ?? '');
  const postType = String(body.postType ?? '');
  const postId = Number(body.postId);

  if (!Number.isInteger(postId) || postId <= 0) {
    res.status(400).json({ error: 'invalid_post_id' });
    return;
  }

  // Only insight + work feed the index. Pages, attachments, etc. are noops.
  if (!INGEST_TYPES.includes(postType as WpPostType)) {
    res.status(200).json({ ok: true, skipped: 'unsupported_post_type', postType });
    return;
  }
  const type = postType as WpPostType;

  try {
    if (reason === 'unpublish' || reason === 'delete') {
      const deleted = await deletePostChunks(postId, type);
      console.log(`[wp-webhook] ${reason} ${type}:${postId} -> deleted ${deleted} chunks`);
      res.status(200).json({ ok: true, action: 'deleted', postId, postType: type, written: 0, deleted });
      return;
    }

    if (reason === 'publish' || reason === 'update') {
      const result = await ingestPostById(postId, type);
      console.log(
        `[wp-webhook] ${reason} ${type}:${postId} -> ${result.action} (written ${result.written}, deleted ${result.deleted})`
      );
      res.status(200).json({ ok: true, postId, postType: type, ...result });
      return;
    }

    res.status(200).json({ ok: true, skipped: 'unhandled_reason', reason });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[wp-webhook] FAILED ${reason} ${type}:${postId} -> ${message}`);
    res.status(500).json({ error: 'ingest_failed', message });
  }
}
