<?php

declare(strict_types=1);

add_action('init', static function (): void {
    if (!post_type_exists('insight')) {
        return;
    }

    register_taxonomy_for_object_type('post_tag', 'insight');
}, 20);
