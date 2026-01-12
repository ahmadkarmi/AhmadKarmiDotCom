<?php

declare(strict_types=1);

add_filter('rest_post_dispatch', static function ($result, WP_REST_Server $server, WP_REST_Request $request) {
    $route = (string) $request->get_route();
    if (strpos($route, '/ak/v1/contact') === false) {
        return $result;
    }

    $origin = get_http_origin();
    if (!is_string($origin) || $origin === '') {
        return $result;
    }

    $o = strtolower($origin);
    $allowed = $o === 'https://www.ahmadkarmi.com'
        || strpos($o, 'http://localhost') === 0
        || strpos($o, 'http://127.0.0.1') === 0;
    if (!$allowed) {
        return $result;
    }

    if ($result instanceof WP_HTTP_Response) {
        $result->header('Access-Control-Allow-Origin', $origin);
        $result->header('Vary', 'Origin');
    }

    return $result;
}, 10, 3);

add_filter('rest_pre_serve_request', static function ($served, $result, WP_REST_Request $request) {
    $route = (string) $request->get_route();
    if (strpos($route, '/ak/v1/contact') === false) {
        return $served;
    }

    $origin = get_http_origin();
    if (!is_string($origin) || $origin === '') {
        return $served;
    }

    $o = strtolower($origin);
    $allowed = $o === 'https://www.ahmadkarmi.com'
        || strpos($o, 'http://localhost') === 0
        || strpos($o, 'http://127.0.0.1') === 0;
    if (!$allowed) {
        return $served;
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');

    return $served;
}, 10, 3);

add_action('rest_api_init', static function (): void {
    register_rest_route('ak/v1', '/contact', [
        'methods' => ['POST', 'OPTIONS'],
        'callback' => static function (WP_REST_Request $request) {
            $origin = get_http_origin();
            if (is_string($origin) && $origin !== '') {
                $o = strtolower($origin);
                $allowed = $o === 'https://www.ahmadkarmi.com'
                    || strpos($o, 'http://localhost') === 0
                    || strpos($o, 'http://127.0.0.1') === 0;
                if (!$allowed) {
                    return new WP_Error('forbidden_origin', 'Origin not allowed', ['status' => 403]);
                }
            }

            if ($request->get_method() === 'OPTIONS') {
                $response = rest_ensure_response(null);
                if (is_string($origin) && $origin !== '') {
                    $response->header('Access-Control-Allow-Origin', $origin);
                    $response->header('Vary', 'Origin');
                }
                $response->header('Access-Control-Allow-Methods', 'POST, OPTIONS');
                $response->header('Access-Control-Allow-Headers', 'Content-Type');
                $response->header('Access-Control-Max-Age', '600');
                return $response;
            }

            $ip = $_SERVER['REMOTE_ADDR'] ?? '';
            $rateKey = 'ak_contact_rate_' . md5((string) $ip);
            $count = (int) get_transient($rateKey);
            if ($count >= 5) {
                return new WP_Error('rate_limited', 'Too many requests. Please try again later.', ['status' => 429]);
            }
            set_transient($rateKey, $count + 1, 10 * MINUTE_IN_SECONDS);

            $params = $request->get_json_params();
            if (!is_array($params)) {
                $params = $request->get_body_params();
            }
            if (!is_array($params)) {
                return new WP_Error('invalid_payload', 'Invalid payload', ['status' => 400]);
            }

            $botCheck = isset($params['bot_check']) ? (string) $params['bot_check'] : '';
            if (trim($botCheck) !== '') {
                return rest_ensure_response(['ok' => true]);
            }

            $name = sanitize_text_field((string) ($params['name'] ?? ''));
            $email = sanitize_email((string) ($params['email'] ?? ''));
            $subject = sanitize_text_field((string) ($params['subject'] ?? ''));
            $message = sanitize_textarea_field((string) ($params['message'] ?? ''));

            if ($name === '' || $email === '' || !is_email($email) || $message === '') {
                return new WP_Error('invalid_fields', 'Missing or invalid fields', ['status' => 400]);
            }

            if (strlen($message) > 5000) {
                return new WP_Error('message_too_long', 'Message is too long', ['status' => 400]);
            }

            $to = defined('AK_CONTACT_TO') ? (string) AK_CONTACT_TO : (string) get_option('admin_email');
            if ($to === '' || !is_email($to)) {
                return new WP_Error('misconfigured', 'Recipient email is not configured', ['status' => 500]);
            }

            $subjectLine = sprintf('[Contact] %s - %s', $subject !== '' ? $subject : 'Message', $name);

            $body = "New contact form submission\n\n";
            $body .= "Name: {$name}\n";
            $body .= "Email: {$email}\n";
            $body .= "Subject: {$subject}\n\n";
            $body .= "Message:\n{$message}\n\n";
            $body .= "IP: {$ip}\n";

            $headers = [
                'Content-Type: text/plain; charset=UTF-8',
                sprintf('Reply-To: %s <%s>', $name, $email),
            ];

            $debug = defined('AK_CONTACT_DEBUG') && (bool) AK_CONTACT_DEBUG;

            $sent = wp_mail($to, $subjectLine, $body, $headers);
            if (!$sent) {
                return new WP_Error('send_failed', 'Failed to send email', ['status' => 500]);
            }

            $payload = ['ok' => true];
            if ($debug) {
                $payload['to'] = $to;
                $payload['subject'] = $subjectLine;
                $payload['wp_mail_smtp_active'] = class_exists('WPMailSMTP\\WP') || defined('WPMS_PLUGIN_VER');
            }

            $response = rest_ensure_response($payload);
            if (is_string($origin) && $origin !== '') {
                $response->header('Access-Control-Allow-Origin', $origin);
                $response->header('Vary', 'Origin');
            }
            return $response;
        },
        'permission_callback' => '__return_true',
    ]);
});
