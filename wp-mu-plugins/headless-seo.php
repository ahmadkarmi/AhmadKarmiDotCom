<?php
/**
 * Plugin Name: Headless SEO (ahmadkarmi.com)
 * Description: Keeps the WordPress origin (admin.ahmadkarmi.com) out of search indexes and adds per-post SEO title/description overrides that the Astro frontend reads.
 * Version: 1.1.0
 */

declare(strict_types=1);

// The public site is the Astro build on www.ahmadkarmi.com. Every page this
// WordPress install renders is a duplicate of it, so the origin must never be
// indexed. This used to depend on All in One SEO's robots meta; it is enforced
// here instead so it survives plugin changes.

// Same effect as ticking Settings > Reading > "Discourage search engines",
// but it cannot be unticked by accident.
add_filter('pre_option_blog_public', static fn () => '0');

add_filter('wp_robots', static function (array $robots): array {
    unset($robots['index'], $robots['follow']);
    $robots['noindex'] = true;
    $robots['nofollow'] = true;
    return $robots;
}, 99);

// Header form covers non-HTML responses (feeds, attachments) on front-end requests.
add_action('send_headers', static function (): void {
    header('X-Robots-Tag: noindex, nofollow', true);
});

// REST responses bypass send_headers; keep the JSON out of indexes too.
add_filter('rest_post_dispatch', static function ($response) {
    if ($response instanceof WP_HTTP_Response) {
        $response->header('X-Robots-Tag', 'noindex, nofollow');
    }
    return $response;
});

// SEO overrides read by frontend/src/lib/wordpress.ts. Empty fields fall back
// to the frontend defaults (post title, ACF description or brief).
add_action('acf/init', static function (): void {
    if (!function_exists('acf_add_local_field_group')) {
        return;
    }

    acf_add_local_field_group([
        'key' => 'group_ak_seo_overrides',
        'title' => 'SEO overrides',
        'fields' => [
            [
                'key' => 'field_ak_seo_title',
                'label' => 'SEO title',
                'name' => 'seo_title',
                'type' => 'text',
                'instructions' => 'Optional. Replaces the post title in search results and share previews. " | Ahmad Al-Karmi" is added automatically, so aim for 45 characters or fewer.',
                'maxlength' => 70,
            ],
            [
                'key' => 'field_ak_seo_description',
                'label' => 'SEO description',
                'name' => 'seo_description',
                'type' => 'textarea',
                'instructions' => 'Optional. Replaces the meta description. Up to 155 characters.',
                'maxlength' => 155,
                'rows' => 3,
                'new_lines' => '',
            ],
        ],
        'location' => [
            [['param' => 'post_type', 'operator' => '==', 'value' => 'insight']],
            [['param' => 'post_type', 'operator' => '==', 'value' => 'work']],
        ],
        'position' => 'side',
        'menu_order' => 99,
        'show_in_rest' => 1,
    ]);
});

// Writes only the SEO override fields. The core posts endpoint re-saves the
// whole post, which bumps `modified` (the sitemap lastmod and article
// updated date) and fires the Vercel deploy and K.AI ingest hooks in
// trigger-vercel-deploy.php. A metadata change is not a content update.
add_action('rest_api_init', static function (): void {
    register_rest_route('ak/v1', '/seo/(?P<id>\d+)', [
        'methods' => 'POST',
        'permission_callback' => static fn (WP_REST_Request $request): bool => current_user_can('edit_post', (int) $request['id']),
        'args' => [
            'seo_title' => ['type' => 'string', 'sanitize_callback' => 'sanitize_text_field'],
            'seo_description' => ['type' => 'string', 'sanitize_callback' => 'sanitize_textarea_field'],
        ],
        'callback' => static function (WP_REST_Request $request) {
            $id = (int) $request['id'];
            if (!in_array(get_post_type($id), ['insight', 'work'], true) || !function_exists('update_field')) {
                return new WP_Error('ak_seo_invalid_post', 'Not an insight or work item.', ['status' => 404]);
            }

            $keys = ['seo_title' => 'field_ak_seo_title', 'seo_description' => 'field_ak_seo_description'];
            foreach ($keys as $name => $key) {
                if ($request->has_param($name)) {
                    update_field($key, (string) $request[$name], $id);
                }
            }

            return [
                'id' => $id,
                'seo_title' => (string) get_field('seo_title', $id),
                'seo_description' => (string) get_field('seo_description', $id),
            ];
        },
    ]);
});
