<?php

namespace App\Rules;

use App\Services\EmailDeliverability;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * The one email check for every address a coordinator (or Dean) types for
 * someone else. Laravel's plain `email` rule accepts "juan@gmail",
 * "juan@gmail.c" and "juan@localhost"; this one needs a real-looking
 * domain with a letters-only ending, and then (unless told not to) asks
 * EmailDeliverability about typos like "gmial.com" or a domain with no mail
 * server, so the form shows "Did you mean ...?" instead of a bounced invite.
 *
 *   'email' => ['required', new CompleteEmail]
 *
 * Call CompleteEmail::normalize() on the input first (lowercase + no spaces)
 * so what is validated is what gets saved.
 */
class CompleteEmail implements ValidationRule
{
    public const MAX_LENGTH = 254;
    private const MAX_LOCAL = 64;

    public function __construct(private readonly bool $checkDelivery = true)
    {
    }

    public static function normalize(mixed $value): string
    {
        return strtolower(preg_replace('/\s+/', '', (string) $value));
    }

    /** A plain-language reason this address is incomplete, or null when it is well-formed. */
    public static function structureProblem(string $email): ?string
    {
        if ($email === '') {
            return 'Enter an email address.';
        }
        if (strlen($email) > self::MAX_LENGTH) {
            return 'This email address is too long.';
        }
        if (substr_count($email, '@') !== 1) {
            return 'Enter a valid email address with a single @, like name@gmail.com.';
        }

        [$local, $domain] = explode('@', $email);

        if ($local === '') {
            return 'Add the part before the @.';
        }
        if (strlen($local) > self::MAX_LOCAL) {
            return 'The part before the @ is too long.';
        }
        if (str_starts_with($local, '.') || str_ends_with($local, '.') || str_contains($local, '..')) {
            return 'The part before the @ cannot start or end with a dot or have two dots in a row.';
        }
        if (!preg_match("/^[a-z0-9!#$%&'*+\\/=?^_`{|}~.-]+$/", $local)) {
            return 'The part before the @ has a character that is not allowed.';
        }

        if ($domain === '') {
            return 'Add the part after the @, like gmail.com.';
        }
        if (strlen($domain) > 253) {
            return 'The part after the @ is too long.';
        }
        if (!str_contains($domain, '.')) {
            return "Incomplete email: add the part after the dot, like .com (\"{$domain}\" needs one).";
        }
        if (str_starts_with($domain, '.') || str_ends_with($domain, '.') || str_contains($domain, '..')) {
            return 'Incomplete email: the part after the @ cannot start or end with a dot or have two dots in a row.';
        }

        $labels = explode('.', $domain);
        foreach ($labels as $label) {
            if ($label === '' || strlen($label) > 63 || !preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/', $label)) {
                return 'The part after the @ has a character that is not allowed.';
            }
        }

        $tld = end($labels);
        if (!preg_match('/^[a-z]{2,}$/', $tld)) {
            return 'Incomplete email: the ending must be letters only and at least 2 long, like .com or .ph.';
        }

        return null;
    }

    /** Structure first, then (optionally) typo / no-mail-server detection. */
    public static function problem(string $email, bool $checkDelivery = true): ?string
    {
        return self::structureProblem($email) ?? ($checkDelivery ? EmailDeliverability::problem($email) : null);
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (!is_string($value)) {
            $fail('Enter a valid email address.');
            return;
        }

        if ($problem = self::problem(self::normalize($value), $this->checkDelivery)) {
            $fail($problem);
        }
    }
}
