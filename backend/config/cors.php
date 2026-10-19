<?php

/*
| Cross-Origin Resource Sharing for the API.
|
| The browser normally never calls Laravel directly: every request goes to the Next.js server
| (/api/* proxies in frontend/src/app/api), which forwards it server to server, and CORS does not apply
| to that. This list is the safety net for the rare direct browser call, so only our own frontend
| origin(s) may read API responses from a page. Localhost origins are added outside production.
| Extra origins (comma separated, full origin with scheme) go in CORS_ALLOWED_ORIGINS.
*/

$origins = array_filter(array_map(
    fn ($o) => rtrim(trim((string) $o), '/'),
    array_merge(
        [env('FRONTEND_URL', 'http://localhost:3000')],
        explode(',', (string) env('CORS_ALLOWED_ORIGINS', '')),
        env('APP_ENV', 'production') === 'production' ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    )
));

return [

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => array_values(array_unique($origins)),

    'allowed_origins_patterns' => [],

    // Bearer-token API (Authorization header), JSON bodies and file uploads.
    'allowed_headers' => ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With', 'X-XSRF-TOKEN'],

    'exposed_headers' => ['Retry-After'],

    'max_age' => 600,

    'supports_credentials' => false,

];
