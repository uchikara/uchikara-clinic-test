<?php
declare(strict_types=1);

return [
    'dry_run' => true,
    'from_email' => 'no-reply@uchikara-clinic.com',
    'from_name' => 'ウチカラクリニック',
    'allowed_hosts' => [
        'test.uchikara-clinic.com',
        'uchikara-clinic.com',
    ],
    'turnstile_secret' => '',
    'forms' => [
        'business' => [
            'recipients' => [
                '担当者メールアドレス',
            ],
            'chat_webhooks' => [
                'Google Chat Webhook URL',
            ],
            'subject' => '【ウチカラクリニック】法人向けお問い合わせ',
            'reply_subject' => '【ウチカラクリニック】お問い合わせを受け付けました',
        ],
        'doctor_recruit' => [
            'recipients' => [
                '担当医師メールアドレス',
            ],
            'chat_webhooks' => [
                'Google Chat Webhook URL',
            ],
            'subject' => '【ウチカラクリニック】医師採用のお問い合わせ',
            'reply_subject' => '【ウチカラクリニック】採用のお問い合わせを受け付けました',
        ],
    ],
];
