<?php

declare(strict_types=1);

function ak_config_value(string $name): ?string
{
    if (defined($name)) {
        $value = trim((string) constant($name));
        if ($value !== '') {
            return $value;
        }
    }

    $env = getenv($name);
    if (is_string($env)) {
        $value = trim($env);
        if ($value !== '') {
            return $value;
        }
    }

    return null;
}

function ak_vercel_deploy_hook_url(): ?string
{
    return ak_config_value('AK_VERCEL_DEPLOY_HOOK_URL');
}

function ak_wp_ingest_webhook_url(): ?string
{
    return ak_config_value('AK_WP_INGEST_WEBHOOK_URL');
}

function ak_wp_ingest_webhook_secret(): ?string
{
    return ak_config_value('AK_WP_INGEST_WEBHOOK_SECRET');
}

function ak_should_trigger_vercel_deploy_for_post(WP_Post $post): bool
{
    if ($post->post_type === 'attachment') {
        return false;
    }

    $obj = get_post_type_object($post->post_type);
    if (!$obj || !isset($obj->public) || !$obj->public) {
        return false;
    }

    return true;
}

function ak_trigger_vercel_deploy(string $reason, WP_Post $post): void
{
    static $triggered = [];

    if (!ak_should_trigger_vercel_deploy_for_post($post)) {
        return;
    }

    $key = $post->ID;
    if (isset($triggered[$key])) {
        return;
    }
    $triggered[$key] = true;

    $body = wp_json_encode([
        'reason' => $reason,
        'postId' => $post->ID,
        'postType' => $post->post_type,
        'postStatus' => $post->post_status,
        'postName' => $post->post_name,
        'postModifiedGmt' => $post->post_modified_gmt,
    ]);
    $body = is_string($body) ? $body : '';

    // 1. Vercel deploy hook — rebuilds the static site so new posts appear in
    //    the /insights and /portfolio listings. Authenticated by the URL token.
    $deployUrl = ak_vercel_deploy_hook_url();
    if ($deployUrl) {
        wp_remote_post($deployUrl, [
            'method' => 'POST',
            'timeout' => 3,
            'redirection' => 0,
            'blocking' => false,
            'headers' => [
                'Content-Type' => 'application/json',
                'User-Agent' => 'ak-wp-mu-plugin/trigger-vercel-deploy',
            ],
            'body' => $body,
        ]);
    }

    // 2. Ask Ahmad ingest webhook — re-embeds just this post into the vector
    //    index. Authenticated by a shared secret header.
    $ingestUrl = ak_wp_ingest_webhook_url();
    $ingestSecret = ak_wp_ingest_webhook_secret();
    if ($ingestUrl && $ingestSecret) {
        wp_remote_post($ingestUrl, [
            'method' => 'POST',
            'timeout' => 3,
            'redirection' => 0,
            'blocking' => false,
            'headers' => [
                'Content-Type' => 'application/json',
                'User-Agent' => 'ak-wp-mu-plugin/trigger-vercel-deploy',
                'X-AK-Webhook-Secret' => $ingestSecret,
            ],
            'body' => $body,
        ]);
    }
}

add_action('transition_post_status', static function (string $new_status, string $old_status, WP_Post $post): void {
    if (wp_is_post_revision($post->ID) || wp_is_post_autosave($post->ID)) {
        return;
    }

    if ($new_status === 'publish' && $old_status !== 'publish') {
        ak_trigger_vercel_deploy('publish', $post);
        return;
    }

    if ($old_status === 'publish' && $new_status !== 'publish') {
        ak_trigger_vercel_deploy('unpublish', $post);
        return;
    }
}, 20, 3);

add_action('post_updated', static function (int $post_id, WP_Post $post_after, WP_Post $post_before): void {
    if ($post_after->post_status !== 'publish' || $post_before->post_status !== 'publish') {
        return;
    }

    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
        return;
    }

    if ($post_after->post_modified_gmt === $post_before->post_modified_gmt) {
        return;
    }

    ak_trigger_vercel_deploy('update', $post_after);
}, 20, 3);

add_action('before_delete_post', static function (int $post_id): void {
    $post = get_post($post_id);
    if (!$post instanceof WP_Post) {
        return;
    }

    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
        return;
    }

    if ($post->post_status !== 'publish') {
        return;
    }

    ak_trigger_vercel_deploy('delete', $post);
}, 20, 1);
