<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Safe handling of files people attach to chat messages.
 *
 * Why this exists: everything on the "public" disk is served straight from our own domain, so a
 * stored .html / .svg / .php file would run as a page of the app (stored XSS). A chat attachment
 * therefore has to pass ALL of these before it is saved:
 *   - the extension the sender gave is in the allow list below,
 *   - the real content (sniffed by the server, not the browser-supplied type) is something that
 *     extension can legitimately be, and is never html / svg / xml / script / executable,
 *   - it is stored under a generated name (uuid + the allowed extension), never the sender's name,
 *   - the type we record and send back to the browser comes from the allow list, not the upload.
 * The display name is a cleaned copy of the original (no paths, control characters or markup).
 */
class SafeUpload
{
    /** Largest chat attachment, in kilobytes (validation rule `max`). */
    public const CHAT_MAX_KB = 10240;

    /** extension => [canonical type served/recorded, accepted sniffed types]. */
    private const ALLOWED = [
        'jpg'  => ['image/jpeg', ['image/jpeg']],
        'jpeg' => ['image/jpeg', ['image/jpeg']],
        'png'  => ['image/png', ['image/png']],
        'gif'  => ['image/gif', ['image/gif']],
        'webp' => ['image/webp', ['image/webp']],
        'pdf'  => ['application/pdf', ['application/pdf']],
        'doc'  => ['application/msword', ['application/msword', 'application/x-ole-storage', 'application/vnd.ms-office', 'application/CDFV2', 'application/octet-stream']],
        'xls'  => ['application/vnd.ms-excel', ['application/vnd.ms-excel', 'application/x-ole-storage', 'application/vnd.ms-office', 'application/CDFV2', 'application/octet-stream']],
        'ppt'  => ['application/vnd.ms-powerpoint', ['application/vnd.ms-powerpoint', 'application/x-ole-storage', 'application/vnd.ms-office', 'application/CDFV2', 'application/octet-stream']],
        'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream']],
        'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream']],
        'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream']],
        'txt'  => ['text/plain', ['text/plain']],
        'csv'  => ['text/csv', ['text/csv', 'text/plain', 'application/csv']],
        'zip'  => ['application/zip', ['application/zip', 'application/x-zip-compressed', 'application/x-zip']],
    ];

    /** Sniffed types that are never acceptable, whatever the extension says. */
    private const FORBIDDEN_TYPES = [
        'text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml',
        'text/javascript', 'application/javascript', 'application/x-javascript',
        'text/x-php', 'application/x-httpd-php', 'application/x-php',
        'application/x-msdownload', 'application/x-dosexec', 'application/x-executable',
        'application/x-sharedlib', 'application/x-sh', 'text/x-shellscript',
    ];

    /** Lower-case extensions that are always refused (belt and braces next to the allow list). */
    private const FORBIDDEN_EXTENSIONS = [
        'html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz', 'xml', 'xsl', 'js', 'mjs',
        'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'exe', 'bat', 'cmd', 'sh', 'jar', 'msi', 'dll', 'com', 'scr', 'vbs',
    ];

    /** Laravel validation rule for a chat attachment: add it to the `attachment` rule list. */
    public static function chatRule(): \Closure
    {
        return function (string $attribute, mixed $value, \Closure $fail): void {
            if (!$value instanceof UploadedFile) {
                return;
            }
            $problem = self::problem($value);
            if ($problem !== null) {
                $fail($problem);
            }
        };
    }

    /** Null when the file is acceptable, otherwise a message for the sender. */
    public static function problem(UploadedFile $file): ?string
    {
        $extension = strtolower($file->getClientOriginalExtension());
        $allowedList = 'images, PDF, Word, Excel, PowerPoint, text, CSV or ZIP files';

        if ($extension === '' || in_array($extension, self::FORBIDDEN_EXTENSIONS, true) || !isset(self::ALLOWED[$extension])) {
            return "This file type is not allowed. You can send {$allowedList}.";
        }

        // Double extensions such as "photo.php.png" or "page.html.txt": no inner part may be a forbidden one.
        foreach (array_slice(explode('.', strtolower(basename($file->getClientOriginalName()))), 1, -1) as $inner) {
            if (in_array($inner, self::FORBIDDEN_EXTENSIONS, true)) {
                return "This file type is not allowed. You can send {$allowedList}.";
            }
        }

        $sniffed = strtolower((string) $file->getMimeType());
        if (in_array($sniffed, self::FORBIDDEN_TYPES, true) || !in_array($sniffed, array_map('strtolower', self::ALLOWED[$extension][1]), true)) {
            return "This file's content does not match its type. You can send {$allowedList}.";
        }

        return null;
    }

    /**
     * Store a validated upload under a generated name and return the columns to save.
     *
     * @return array{attachment_path: string, attachment_name: string, attachment_type: string, attachment_size: int}
     */
    public static function storeChat(UploadedFile $file, string $directory, string $disk = 'public'): array
    {
        $extension = strtolower($file->getClientOriginalExtension());
        $path = Storage::disk($disk)->putFileAs($directory, $file, Str::uuid()->toString().'.'.$extension);

        return [
            'attachment_path' => $path,
            'attachment_name' => self::displayName($file->getClientOriginalName(), $extension),
            'attachment_type' => self::ALLOWED[$extension][0],
            'attachment_size' => (int) $file->getSize(),
        ];
    }

    /** A name that is safe to show and to put in a header: no path, markup or control characters. */
    public static function displayName(string $name, string $fallbackExtension = ''): string
    {
        $name = basename(str_replace('\\', '/', $name));
        $name = preg_replace('/[\x00-\x1F\x7F<>:"|?*\\\\\/]+/u', '', $name) ?? '';
        $name = trim(strip_tags($name));
        $name = Str::limit($name, 120, '');

        return $name !== '' ? $name : 'file'.($fallbackExtension !== '' ? ".{$fallbackExtension}" : '');
    }
}
