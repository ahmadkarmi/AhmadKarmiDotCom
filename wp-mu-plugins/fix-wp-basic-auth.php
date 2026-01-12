<?php
declare(strict_types=1);

add_filter('determine_current_user', static function ($user_id) {
    if (!empty($user_id)) {
        return $user_id;
    }

    if (!function_exists('wp_authenticate_application_password')) {
        return $user_id;
    }

    $username = null;
    $password = null;

    if (isset($_SERVER['PHP_AUTH_USER'], $_SERVER['PHP_AUTH_PW'])) {
        $username = $_SERVER['PHP_AUTH_USER'];
        $password = $_SERVER['PHP_AUTH_PW'];
    } else {
        $header = $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? $_SERVER['HTTP_X_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_X_AUTHORIZATION']
            ?? $_SERVER['HTTP_X_WP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_X_WP_AUTHORIZATION']
            ?? $_SERVER['HTTP_X_BASIC_AUTH']
            ?? $_SERVER['REDIRECT_HTTP_X_BASIC_AUTH']
            ?? $_SERVER['HTTP_X_AUTH']
            ?? $_SERVER['REDIRECT_HTTP_X_AUTH']
            ?? $_SERVER['Authorization']
            ?? null;
        if (is_string($header) && stripos($header, 'basic ') === 0) {
            $encoded = trim(substr($header, 6));
            $decoded = base64_decode($encoded, true);
            if (is_string($decoded) && strpos($decoded, ':') !== false) {
                [$username, $password] = explode(':', $decoded, 2);
                $_SERVER['PHP_AUTH_USER'] = $username;
                $_SERVER['PHP_AUTH_PW'] = $password;
            }
        }
    }

    if (!is_string($username) || $username === '' || !is_string($password) || $password === '') {
        return $user_id;
    }

    $authenticated = wp_authenticate_application_password(null, $username, $password);
    if (is_wp_error($authenticated)) {
        return $user_id;
    }

    return (int) $authenticated->ID;
}, 20);
