<?php
declare(strict_types=1);

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_set_cookie_params([
        'httponly' => true,
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'samesite' => 'Lax',
    ]);
    session_start();
}

function uchikara_home_directory(): string
{
    $home = trim((string) getenv('HOME'));
    if ($home !== '') {
        return rtrim($home, '/');
    }
    if (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
        $user = posix_getpwuid(posix_geteuid());
        if (is_array($user) && !empty($user['dir'])) {
            return rtrim((string) $user['dir'], '/');
        }
    }
    return '';
}

function uchikara_form_config(): array
{
    static $config;
    if ($config !== null) {
        return $config;
    }

    $configPath = trim((string) getenv('UCHIKARA_FORM_CONFIG'));
    if ($configPath === '') {
        $home = uchikara_home_directory();
        $configPath = $home !== ''
            ? $home . '/.config/uchikara-static-forms/config.php'
            : '';
    }
    if ($configPath === '' || !is_file($configPath)) {
        error_log('Uchikara form configuration is missing.');
        return $config = [];
    }
    $loaded = require $configPath;
    return $config = is_array($loaded) ? $loaded : [];
}

function uchikara_string(string $key): string
{
    return trim((string) ($_POST[$key] ?? ''));
}

function uchikara_length(string $value): int
{
    return function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
}

function uchikara_form_definition(string $type): ?array
{
    $definitions = [
        'business' => [
            'label' => '法人向けオンライン診療のお問い合わせ',
            'required' => ['your-company', 'your-name', 'your-email', 'your-reason', 'your-acceptance'],
            'allowed_reason' => ['オンライン診療の利用希望', '資料請求', 'お問い合わせ'],
            'success_path' => '/business/?sent=1',
        ],
        'doctor_recruit' => [
            'label' => '医師採用のお問い合わせ',
            'required' => ['your-name', 'your-email', 'your-region', 'your-acceptance'],
            'success_path' => '/recruit/doctor/?sent=1',
        ],
    ];
    return $definitions[$type] ?? null;
}

function uchikara_validate_request(array $config): array
{
    $allowedHosts = array_map('strtolower', array_filter(array_map('strval', (array) ($config['allowed_hosts'] ?? []))));
    $host = strtolower(preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')));
    if ($allowedHosts === [] || !in_array($host, $allowedHosts, true)) {
        return ['送信元を確認できませんでした。'];
    }

    $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($origin !== '') {
        $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
        if ($originHost === '' || !in_array($originHost, $allowedHosts, true)) {
            return ['送信元を確認できませんでした。'];
        }
    }
    return [];
}

function uchikara_validate_runtime_config(array $config, array $formConfig): array
{
    if (!empty($config['dry_run'])) {
        return [];
    }

    $errors = [];
    if (!filter_var(trim((string) ($config['from_email'] ?? '')), FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'from_email';
    }
    if (trim((string) ($config['turnstile_secret'] ?? '')) === '') {
        $errors[] = 'turnstile_secret';
    }

    $recipients = array_values(array_filter(array_map(
        static fn ($value): bool => filter_var(trim((string) $value), FILTER_VALIDATE_EMAIL) !== false,
        (array) ($formConfig['recipients'] ?? [])
    )));
    if ($recipients === []) {
        $errors[] = 'recipients';
    }

    $webhooks = array_values(array_filter(array_map(
        static fn ($value): bool => preg_match('#^https://chat\.googleapis\.com/#', trim((string) $value)) === 1,
        (array) ($formConfig['chat_webhooks'] ?? [])
    )));
    if ($webhooks === []) {
        $errors[] = 'chat_webhooks';
    }

    if ($errors !== []) {
        error_log('Uchikara form configuration is invalid: ' . implode(', ', $errors));
    }
    return $errors;
}

function uchikara_validate_form(string $type, array $definition): array
{
    $values = [
        'company' => uchikara_string('your-company'),
        'name' => uchikara_string('your-name'),
        'email' => uchikara_string('your-email'),
        'tel' => uchikara_string('your-tel'),
        'reason' => uchikara_string('your-reason'),
        'region' => uchikara_string('your-region'),
        'style' => uchikara_string('your-style'),
        'message' => uchikara_string('your-message'),
    ];

    $labels = [
        'your-company' => '企業名',
        'your-name' => 'お名前',
        'your-email' => 'メールアドレス',
        'your-reason' => 'お問い合わせ内容',
        'your-region' => 'お住まいの地域',
        'your-acceptance' => 'プライバシーポリシーへの同意',
    ];
    $postKeys = [
        'your-company' => 'company',
        'your-name' => 'name',
        'your-email' => 'email',
        'your-reason' => 'reason',
        'your-region' => 'region',
    ];

    $errors = [];
    foreach ($definition['required'] as $field) {
        if ($field === 'your-acceptance') {
            if (empty($_POST[$field])) {
                $errors[] = 'プライバシーポリシーへの同意が必要です。';
            }
            continue;
        }
        $valueKey = $postKeys[$field] ?? '';
        if ($valueKey === '' || $values[$valueKey] === '') {
            $errors[] = ($labels[$field] ?? $field) . 'を入力してください。';
        }
    }

    if ($values['email'] !== '' && !filter_var($values['email'], FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'メールアドレスを正しく入力してください。';
    }
    if ($values['tel'] !== '' && !preg_match('/^(?:[0-9]{10,11}|0[0-9]{1,4}-[0-9]{1,4}-[0-9]{3,4})$/', $values['tel'])) {
        $errors[] = '電話番号を正しく入力してください。';
    }
    if ($type === 'business' && !in_array($values['reason'], $definition['allowed_reason'], true)) {
        $errors[] = 'お問い合わせ内容を選択してください。';
    }

    $limits = ['company' => 200, 'name' => 100, 'email' => 254, 'tel' => 30, 'reason' => 100, 'region' => 100, 'style' => 200, 'message' => 5000];
    foreach ($limits as $key => $limit) {
        if (uchikara_length($values[$key]) > $limit) {
            $errors[] = '入力内容が長すぎます。';
            break;
        }
    }
    return [$values, array_values(array_unique($errors))];
}

function uchikara_verify_turnstile(array $config): bool
{
    if (!empty($config['dry_run'])) {
        return true;
    }
    $secret = trim((string) ($config['turnstile_secret'] ?? ''));
    $token = uchikara_string('cf-turnstile-response');
    if ($secret === '' || $token === '') {
        return false;
    }
    $payload = http_build_query([
        'secret' => $secret,
        'response' => $token,
        'remoteip' => (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
    ]);

    if (function_exists('curl_init')) {
        $curl = curl_init('https://challenges.cloudflare.com/turnstile/v0/siteverify');
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        ]);
        $response = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $failed = curl_errno($curl) !== 0;
        curl_close($curl);
        if ($failed || $status < 200 || $status >= 300) {
            return false;
        }
    } else {
        $context = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => $payload,
            'timeout' => 8,
            'ignore_errors' => true,
        ]]);
        $response = @file_get_contents('https://challenges.cloudflare.com/turnstile/v0/siteverify', false, $context);
        if ($response === false) {
            return false;
        }
    }
    $result = json_decode((string) $response, true);
    if (!is_array($result) || empty($result['success'])) {
        return false;
    }
    $hostname = strtolower(trim((string) ($result['hostname'] ?? '')));
    $allowedHosts = array_map('strtolower', array_filter(array_map('strval', (array) ($config['allowed_hosts'] ?? []))));
    return $hostname !== '' && in_array($hostname, $allowedHosts, true);
}

function uchikara_send_mail(string $to, string $from, string $fromName, string $replyTo, string $subject, string $body): bool
{
    if (!filter_var($to, FILTER_VALIDATE_EMAIL) || !filter_var($from, FILTER_VALIDATE_EMAIL) || !filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    $safeName = str_replace(["\r", "\n"], '', $fromName);
    $headers = implode("\r\n", [
        'MIME-Version: 1.0',
        'From: ' . $safeName . ' <' . $from . '>',
        'Reply-To: ' . $replyTo,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
    ]);
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $normalizedBody = str_replace(["\r\n", "\r"], "\n", $body);
    $encodedBody = chunk_split(base64_encode($normalizedBody), 76, "\r\n");
    return mail($to, $encodedSubject, $encodedBody, $headers, '-f' . $from);
}

function uchikara_notify_google_chat(string $webhook, string $message): bool
{
    if (!preg_match('#^https://chat\.googleapis\.com/#', $webhook)) {
        return false;
    }
    $payload = json_encode(['text' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    if (function_exists('curl_init')) {
        $curl = curl_init($webhook);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=UTF-8'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 5,
        ]);
        curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $failed = curl_errno($curl) !== 0;
        curl_close($curl);
        return !$failed && $status >= 200 && $status < 300;
    }
    $context = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json; charset=UTF-8\r\n",
        'content' => $payload,
        'timeout' => 5,
        'ignore_errors' => true,
    ]]);
    $response = @file_get_contents($webhook, false, $context);
    $statusLine = $http_response_header[0] ?? '';
    return $response !== false && preg_match('/\s2\d{2}\s/', $statusLine) === 1;
}

function uchikara_message_lines(string $type, array $values, string $label): array
{
    $lines = ['【ウチカラクリニック】' . $label];
    if ($type === 'business') {
        $lines[] = 'お問い合わせ内容: ' . $values['reason'];
        $lines[] = '企業名: ' . $values['company'];
    }
    $lines[] = 'お名前: ' . $values['name'];
    $lines[] = 'メールアドレス: ' . $values['email'];
    if ($type === 'business') {
        $lines[] = '電話番号: ' . ($values['tel'] !== '' ? $values['tel'] : '未入力');
    } else {
        $lines[] = 'お住まいの地域: ' . $values['region'];
        $lines[] = '希望勤務スタイル: ' . ($values['style'] !== '' ? $values['style'] : '未入力');
    }
    $lines[] = '';
    $lines[] = 'お問い合わせ内容:';
    $lines[] = $values['message'] !== '' ? $values['message'] : '未入力';
    return $lines;
}

function uchikara_process_form(): array
{
    $config = uchikara_form_config();
    if ($config === []) {
        return ['ok' => false, 'errors' => ['送信設定を確認できませんでした。']];
    }
    $requestErrors = uchikara_validate_request($config);
    if ($requestErrors !== []) {
        return ['ok' => false, 'errors' => $requestErrors];
    }

    $type = uchikara_string('form_type');
    $definition = uchikara_form_definition($type);
    $formConfig = (array) (($config['forms'] ?? [])[$type] ?? []);
    if ($definition === null || $formConfig === []) {
        return ['ok' => false, 'errors' => ['送信先を確認できませんでした。']];
    }
    if (uchikara_validate_runtime_config($config, $formConfig) !== []) {
        return ['ok' => false, 'errors' => ['送信設定に不備があります。管理者へお問い合わせください。']];
    }

    if (uchikara_string('website') !== '') {
        return ['ok' => true, 'errors' => [], 'success_path' => $definition['success_path']];
    }
    $lastSubmit = (int) ($_SESSION['uchikara_form_last_submit'] ?? 0);
    if ($lastSubmit > 0 && time() - $lastSubmit < 30) {
        return ['ok' => false, 'errors' => ['連続送信はできません。少し時間をおいてください。']];
    }

    [$values, $errors] = uchikara_validate_form($type, $definition);
    if (!uchikara_verify_turnstile($config)) {
        $errors[] = '迷惑送信防止チェックを完了してください。';
    }
    if ($errors !== []) {
        return ['ok' => false, 'errors' => array_values(array_unique($errors))];
    }

    $lines = uchikara_message_lines($type, $values, $definition['label']);
    $body = implode("\n", $lines);
    $subject = trim((string) ($formConfig['subject'] ?? ('【ウチカラクリニック】' . $definition['label'])));
    $from = trim((string) ($config['from_email'] ?? ''));
    $fromName = trim((string) ($config['from_name'] ?? 'ウチカラクリニック'));
    $recipients = array_values(array_filter(array_map(
        static fn ($value): string => trim((string) $value),
        (array) ($formConfig['recipients'] ?? [])
    )));

    $mailSent = !empty($config['dry_run']);
    if (!$mailSent) {
        $mailSent = $recipients !== [];
        foreach ($recipients as $recipient) {
            if (!uchikara_send_mail($recipient, $from, $fromName, $values['email'], $subject, $body)) {
                $mailSent = false;
                error_log('Uchikara form recipient mail failed: ' . $type);
            }
        }
    }
    if (!$mailSent) {
        return ['ok' => false, 'errors' => ['送信に失敗しました。時間をおいて再度お試しください。']];
    }

    if (empty($config['dry_run'])) {
        $replySubject = trim((string) ($formConfig['reply_subject'] ?? '【ウチカラクリニック】お問い合わせを受け付けました'));
        $replyBody = implode("\n", [
            $values['name'] . ' 様',
            '',
            'お問い合わせを受け付けました。内容を確認のうえ、担当者よりご連絡します。',
            '',
            '※このメールは自動送信です。',
        ]);
        if (!uchikara_send_mail($values['email'], $from, $fromName, $from, $replySubject, $replyBody)) {
            error_log('Uchikara form auto-reply failed: ' . $type);
        }

        $chatMessage = implode("\n", $lines);
        foreach ((array) ($formConfig['chat_webhooks'] ?? []) as $webhook) {
            if (!uchikara_notify_google_chat(trim((string) $webhook), $chatMessage)) {
                error_log('Uchikara Google Chat notification failed: ' . $type);
            }
        }
    }

    $_SESSION['uchikara_form_last_submit'] = time();
    return [
        'ok' => true,
        'errors' => [],
        'success_path' => $definition['success_path'],
        'dry_run' => !empty($config['dry_run']),
    ];
}
