<?php

namespace Tests\Feature;

use Tests\TestCase;

/** The API only answers cross-origin browser calls for our own frontend origin(s). */
class CorsTest extends TestCase
{
    private function preflight(string $origin)
    {
        return $this->call('OPTIONS', '/api/auth/login', [], [], [], [
            'HTTP_ORIGIN' => $origin,
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
            'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization,content-type',
        ]);
    }

    public function test_an_unknown_origin_gets_no_cors_headers(): void
    {
        $response = $this->preflight('https://evil.example');

        $this->assertNull($response->headers->get('Access-Control-Allow-Origin'));
        $this->assertNotSame('*', $response->headers->get('Access-Control-Allow-Origin'));
    }

    public function test_the_frontend_origin_is_allowed_with_the_authorization_header(): void
    {
        $origin = rtrim((string) config('cors.allowed_origins.0'), '/');
        $this->assertNotEmpty($origin);

        $response = $this->preflight($origin);

        $this->assertSame($origin, $response->headers->get('Access-Control-Allow-Origin'));
        $this->assertStringContainsStringIgnoringCase('authorization', (string) $response->headers->get('Access-Control-Allow-Headers'));
    }

    public function test_a_real_request_from_an_unknown_origin_is_not_readable_cross_origin(): void
    {
        $response = $this->withHeaders(['Origin' => 'https://evil.example'])->getJson('/api/legal');

        $this->assertNull($response->headers->get('Access-Control-Allow-Origin'));
    }

    public function test_the_allowed_list_is_never_a_wildcard(): void
    {
        $this->assertNotContains('*', config('cors.allowed_origins'));
        $this->assertFalse(config('cors.supports_credentials'));
    }
}
