<?php

namespace App\Support;

/**
 * Which characters a structured text field may hold. SQL injection is already impossible (every query binds its
 * values), but names and codes have no reason to contain quotes-and-semicolons soup, markup or symbols, so they are
 * refused here as well. Free text (messages, remarks, descriptions) keeps every character. The same sets are used
 * while typing in frontend/src/lib/inputRules.js.
 */
final class TextRules
{
    /** School and company names: letters, digits, spaces and . , & ' ’ ( ) - / # : ("St. Mary's College, Inc."). */
    public const ORG_NAME = "/^[\\p{L}\\p{M}\\p{N}][\\p{L}\\p{M}\\p{N} .,&'’()\\/#:\\-]*$/u";

    /** People: letters, spaces and . ' - ("Ma. Dela Cruz-Santos"). */
    public const PERSON_NAME = "/^[\\p{L}\\p{M}][\\p{L}\\p{M} .'\\-]*$/u";

    /** A name on a certificate or a signatory line may also have a comma ("Dela Cruz, Juan", "Ana Reyes, MIT"). */
    public const SIGN_NAME = "/^[\\p{L}\\p{M}][\\p{L}\\p{M} .,'\\-]*$/u";

    public const ORG_NAME_MESSAGE = 'Use letters, numbers, spaces and . , & \' ( ) - / # : only.';
    public const PERSON_NAME_MESSAGE = 'Use letters, spaces, periods, apostrophes and hyphens only.';
    public const SIGN_NAME_MESSAGE = 'Use letters, spaces, periods, commas, apostrophes and hyphens only.';
}
