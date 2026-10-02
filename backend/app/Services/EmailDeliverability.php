<?php

namespace App\Services;

use Throwable;

/**
 * Catches invitation emails that can't possibly arrive before one is sent:
 * a misspelled common provider ("juan@gmial.com") or a domain that has no
 * mail server at all. It can't tell whether a specific Gmail *inbox* exists
 * — no provider reveals that — which is what bounce tracking is for.
 */
class EmailDeliverability
{
    private const PROVIDERS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'ymail.com', 'live.com'];

    // Misspellings common enough to flag even if a squatter registered them.
    private const KNOWN_TYPOS = [
        'gmial.com' => 'gmail.com', 'gmai.com' => 'gmail.com', 'gamil.com' => 'gmail.com', 'gnail.com' => 'gmail.com',
        'gmal.com' => 'gmail.com', 'gmaill.com' => 'gmail.com', 'gmail.co' => 'gmail.com', 'gmail.con' => 'gmail.com',
        'gmail.cm' => 'gmail.com', 'gmail.om' => 'gmail.com', 'gmail.comm' => 'gmail.com', 'gmailcom' => 'gmail.com',
        'yahooo.com' => 'yahoo.com', 'yaho.com' => 'yahoo.com', 'yahoo.con' => 'yahoo.com', 'yahoo.co' => 'yahoo.com',
        'hotmial.com' => 'hotmail.com', 'hotmal.com' => 'hotmail.com', 'outlok.com' => 'outlook.com', 'outlook.con' => 'outlook.com',
    ];

    /** @var array<string, bool> per-request cache of DNS answers */
    private static array $domainCache = [];

    /** A coordinator-facing problem with this address, or null when it looks deliverable. */
    public static function problem(string $email): ?string
    {
        $at = strrpos($email, '@');
        if ($at === false) {
            return null;
        }
        $local = substr($email, 0, $at);
        $domain = strtolower(substr($email, $at + 1));

        if (isset(self::KNOWN_TYPOS[$domain])) {
            return "Did you mean {$local}@" . self::KNOWN_TYPOS[$domain] . '?';
        }

        if (!self::domainAcceptsMail($domain)) {
            $close = self::closestProvider($domain);
            return $close
                ? "\"{$domain}\" can't receive email. Did you mean {$local}@{$close}?"
                : "\"{$domain}\" can't receive email — check the spelling.";
        }

        return null;
    }

    private static function domainAcceptsMail(string $domain): bool
    {
        if (in_array($domain, self::PROVIDERS, true)) {
            return true;
        }
        if (!array_key_exists($domain, self::$domainCache)) {
            try {
                // MX only: some ISPs answer A lookups for domains that don't
                // exist, which would make every typo look deliverable.
                self::$domainCache[$domain] = checkdnsrr($domain, 'MX');
            } catch (Throwable) {
                // DNS trouble on our side shouldn't block a real address.
                self::$domainCache[$domain] = true;
            }
        }
        return self::$domainCache[$domain];
    }

    private static function closestProvider(string $domain): ?string
    {
        foreach (self::PROVIDERS as $provider) {
            if (levenshtein($domain, $provider) <= 2) {
                return $provider;
            }
        }
        return null;
    }
}
