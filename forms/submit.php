<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    exit;
}

$result = uchikara_process_form();
$wantsJson = str_contains(strtolower((string) ($_SERVER['HTTP_ACCEPT'] ?? '')), 'application/json');

if ($wantsJson) {
    http_response_code($result['ok'] ? 200 : 422);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store');
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

if ($result['ok']) {
    header('Location: ' . $result['success_path'], true, 303);
    exit;
}

http_response_code(422);
header('Content-Type: text/plain; charset=UTF-8');
echo implode("\n", $result['errors']);
