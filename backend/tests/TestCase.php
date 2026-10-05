<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    /**
     * RefreshDatabase drops every table before each test, so a test run that
     * somehow points at the real local database (a cached config, a changed
     * phpunit.xml) would wipe it. Refuse to boot unless the connection is the
     * dedicated test database.
     */
    public function createApplication()
    {
        $app = parent::createApplication();

        $connection = $app['config']->get('database.default');
        $database = $app['config']->get("database.connections.{$connection}.database");

        if ($database !== 'internova_testing') {
            throw new RuntimeException("Tests must run on the internova_testing database, not [{$connection}:{$database}].");
        }

        return $app;
    }
}
