<?php
declare(strict_types=1);

http_response_code(404);
header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: no-store');
echo "404 Not Found\n";
