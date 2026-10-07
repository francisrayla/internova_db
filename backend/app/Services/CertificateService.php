<?php

namespace App\Services;

use DOMDocument;
use DOMElement;
use DOMXPath;
use RuntimeException;
use ZipArchive;

/**
 * Fills a PowerPoint (.pptx) certificate template. The supervisor types markers such as
 * {{NAME}} into the slide once; each certificate is a copy of the file with the markers
 * replaced. PowerPoint often splits one typed marker over several text runs
 * ("{{", "NAME", "}}"), so a paragraph is treated as one piece of text.
 */
class CertificateService
{
    /** marker => what it is replaced with */
    public const PLACEHOLDERS = [
        'NAME' => "The intern's full name",
        'COURSE' => "The intern's course",
        'HOURS' => 'Hours rendered',
        'COMPANY' => 'The company name',
        'SCHOOL' => 'The school name',
        'START_DATE' => 'First day of the training',
        'END_DATE' => 'Last day of the training',
        'DATE' => 'Date the certificate is given',
        'SUPERVISOR' => "The supervisor's name",
    ];

    private const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    private const TOKEN = '/\{\{\s*([A-Za-z_]+)\s*\}\}/';

    /** The slide files of a presentation, in slide order. */
    private static function slideNames(ZipArchive $zip): array
    {
        $names = [];
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $n = $zip->getNameIndex($i);
            if (preg_match('#^ppt/slides/slide\d+\.xml$#', $n)) {
                $names[] = $n;
            }
        }
        natsort($names);

        return array_values($names);
    }

    public static function isPresentation(string $path): bool
    {
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) {
            return false;
        }
        $ok = $zip->locateName('ppt/presentation.xml') !== false && count(self::slideNames($zip)) > 0;
        $zip->close();

        return $ok;
    }

    /** The recognised markers that appear anywhere on the slides, e.g. ['NAME', 'HOURS']. */
    public static function markersIn(string $path): array
    {
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) {
            return [];
        }
        $found = [];
        foreach (self::slideNames($zip) as $name) {
            $dom = self::load($zip->getFromName($name));
            if (!$dom) {
                continue;
            }
            foreach (self::paragraphs($dom) as $runs) {
                $text = implode('', array_map(fn (DOMElement $t) => $t->textContent, $runs));
                if (preg_match_all(self::TOKEN, $text, $m)) {
                    foreach ($m[1] as $token) {
                        $found[strtoupper($token)] = true;
                    }
                }
            }
        }
        $zip->close();

        return array_values(array_filter(array_keys($found), fn ($k) => isset(self::PLACEHOLDERS[$k])));
    }

    /**
     * A copy of the template with the markers replaced. Returns the temp file path;
     * the caller sends it and deletes it.
     *
     * @param array<string,string> $values marker => text
     */
    public static function fill(string $templatePath, array $values): string
    {
        $out = tempnam(sys_get_temp_dir(), 'cert');
        if ($out === false || !copy($templatePath, $out)) {
            throw new RuntimeException('Could not prepare the certificate file.');
        }
        $zip = new ZipArchive();
        if ($zip->open($out) !== true) {
            @unlink($out);
            throw new RuntimeException('The template is not a valid PowerPoint file.');
        }

        $values = array_change_key_case($values, CASE_UPPER);
        $replace = function (string $text) use ($values): string {
            return preg_replace_callback(self::TOKEN, function ($m) use ($values) {
                $key = strtoupper($m[1]);

                return array_key_exists($key, $values) ? (string) $values[$key] : $m[0];
            }, $text);
        };

        foreach (self::slideNames($zip) as $name) {
            $dom = self::load($zip->getFromName($name));
            if (!$dom) {
                continue;
            }
            $changed = false;
            foreach (self::paragraphs($dom) as $runs) {
                $combined = implode('', array_map(fn (DOMElement $t) => $t->textContent, $runs));
                if (!str_contains($combined, '{{')) {
                    continue;
                }
                // A marker typed in one run keeps that run's formatting (bold, size, colour).
                foreach ($runs as $t) {
                    $new = $replace($t->textContent);
                    if ($new !== $t->textContent) {
                        self::setText($t, $new);
                        $changed = true;
                    }
                }
                // A marker PowerPoint split over several runs: put the whole line in the first run.
                $after = implode('', array_map(fn (DOMElement $t) => $t->textContent, $runs));
                if (preg_match(self::TOKEN, $after) && $runs) {
                    $merged = $replace($after);
                    if ($merged !== $after) {
                        self::setText($runs[0], $merged);
                        foreach (array_slice($runs, 1) as $t) {
                            self::setText($t, '');
                        }
                        $changed = true;
                    }
                }
            }
            if ($changed) {
                $zip->addFromString($name, $dom->saveXML());
            }
        }
        $zip->close();

        return $out;
    }

    /** Replaces an element's text safely (names with & or quotes must not break the XML). */
    private static function setText(DOMElement $el, string $text): void
    {
        while ($el->firstChild) {
            $el->removeChild($el->firstChild);
        }
        $el->appendChild($el->ownerDocument->createTextNode($text));
    }

    private static function load(string|false $xml): ?DOMDocument
    {
        if ($xml === false || $xml === '') {
            return null;
        }
        $dom = new DOMDocument();
        $prev = libxml_use_internal_errors(true);
        $ok = $dom->loadXML($xml, LIBXML_NONET | LIBXML_NOBLANKS);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        return $ok ? $dom : null;
    }

    /** Every paragraph's text elements (a:t of its runs) in reading order. */
    private static function paragraphs(DOMDocument $dom): array
    {
        $xp = new DOMXPath($dom);
        $xp->registerNamespace('a', self::NS_A);
        $out = [];
        foreach ($xp->query('//a:p') as $p) {
            $runs = [];
            foreach ($xp->query('./a:r/a:t', $p) as $t) {
                $runs[] = $t;
            }
            if ($runs) {
                $out[] = $runs;
            }
        }

        return $out;
    }
}
