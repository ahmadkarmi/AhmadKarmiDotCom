<?php
declare(strict_types=1);

add_action('init', static function (): void {
    if (!post_type_exists('work')) {
        return;
    }

    $role = get_role('administrator');
    if (!$role) {
        return;
    }

    $obj = get_post_type_object('work');
    if (!$obj || !isset($obj->cap) || !is_object($obj->cap)) {
        return;
    }

    foreach ((array) $obj->cap as $cap) {
        if (!is_string($cap) || $cap === '') {
            continue;
        }
        if (!$role->has_cap($cap)) {
            $role->add_cap($cap);
        }
    }
}, 999);

add_action('registered_post_type', static function (string $post_type): void {
    if ($post_type !== 'work') {
        return;
    }

    $role = get_role('administrator');
    if (!$role) {
        return;
    }

    $obj = get_post_type_object('work');
    if (!$obj || !isset($obj->cap) || !is_object($obj->cap)) {
        return;
    }

    foreach ((array) $obj->cap as $cap) {
        if (!is_string($cap) || $cap === '') {
            continue;
        }
        if (!$role->has_cap($cap)) {
            $role->add_cap($cap);
        }
    }
}, 10, 1);
