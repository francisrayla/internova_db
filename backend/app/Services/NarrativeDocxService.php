<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Settings;
use PhpOffice\PhpWord\SimpleType\Jc;
use PhpOffice\PhpWord\Style\Tab;
use PhpOffice\PhpWord\Style\Table as TableStyle;

/**
 * Word (.docx) version of the narrative report. It consumes the exact payload
 * of NarrativeReportService::build() so Word and the on-screen report never
 * diverge. Image URLs in the payload are mapped back to files on the public
 * disk here; the JSON API never exposes filesystem paths. Missing files are
 * skipped, and images are downsized before embedding to keep the file small.
 *
 * Page: 8.5 x 13 in, margins 1in top/bottom and 1.25in left/right (text width
 * 8640 twips). The letterhead lives in the section header so Word repeats it
 * on every page.
 */
class NarrativeDocxService
{
    private const TEXT_WIDTH = 8640;
    private const PT_PER_IN = 72;
    private const CHED_ADDRESS = 'Higher Education Development Center (HEC Bldg.) C.P Garcia Avenue, Diliman, Quezon City';

    private PhpWord $word;
    private array $tempFiles = [];

    /** Build the document and return the path of a temporary .docx file. */
    public static function build(array $data): string
    {
        return (new self())->make($data);
    }

    private function make(array $data): string
    {
        Settings::setOutputEscapingEnabled(true);
        $this->word = new PhpWord();
        $this->word->setDefaultFontName('Arial Narrow');
        $this->word->setDefaultFontSize(12);
        $this->word->setDefaultParagraphStyle(['spaceAfter' => 0, 'spaceBefore' => 0, 'lineHeight' => 1.1]);

        $template = $data['template'];
        $section = $this->word->addSection([
            'pageSizeW' => 12240,
            'pageSizeH' => 18720,
            'marginTop' => 1440,
            'marginBottom' => 1440,
            'marginLeft' => 1800,
            'marginRight' => 1800,
            'headerHeight' => 720,
            'footerHeight' => 720,
        ]);

        $this->letterhead($section, $template);
        $this->cover($section, $data, $template);
        $this->titlePage($section, $data, $template);
        $this->toc($section, $template);
        foreach ($template['sections'] as $s) {
            $section->addText($s['title'], ['bold' => true, 'size' => 14, 'allCaps' => true], [
                'alignment' => Jc::CENTER,
                'pageBreakBefore' => true,
                'spaceAfter' => 320,
                'keepNext' => true,
            ]);
            $this->sectionBody($section, $s, $data, $template);
        }

        $path = tempnam(sys_get_temp_dir(), 'nrdocx');
        try {
            IOFactory::createWriter($this->word, 'Word2007')->save($path);
        } finally {
            foreach ($this->tempFiles as $f) {
                @unlink($f);
            }
        }

        return $path;
    }

    // ---------------------------------------------------------------- header

    private function letterhead($section, array $template): void
    {
        $header = $section->addHeader();
        $lh = $template['letterhead'];
        $logo = $this->prepareImage($this->pathFromUrl($template['logo_url'] ?? null), 400);

        $table = $header->addTable(['borderSize' => 0, 'borderColor' => 'FFFFFF', 'layout' => TableStyle::LAYOUT_FIXED, 'cellMargin' => 0]);
        $table->addRow();
        $logoW = 1584;
        if ($logo) {
            $cell = $table->addCell($logoW, ['valign' => 'center']);
            [$w, $h] = $this->fit($logo['w'], $logo['h'], 1.1 * self::PT_PER_IN, 0.95 * self::PT_PER_IN);
            $cell->addImage($logo['path'], ['width' => $w, 'height' => $h]);
        }
        $textCell = $table->addCell($logo ? self::TEXT_WIDTH - $logoW : self::TEXT_WIDTH, ['valign' => 'center']);
        $textCell->addText((string) $lh['school_name'], ['bold' => true, 'size' => 14, 'allCaps' => true], ['alignment' => Jc::CENTER]);
        foreach (['address', 'contact', 'website'] as $k) {
            if (!empty($lh[$k])) {
                $textCell->addText((string) $lh[$k], ['size' => 10], ['alignment' => Jc::CENTER]);
            }
        }
        // Rule under the letterhead.
        $header->addText('', ['size' => 2], ['borderBottomSize' => 16, 'borderBottomColor' => '000000', 'spaceAfter' => 0]);
    }

    // ----------------------------------------------------------- front pages

    private function cover($section, array $data, array $template): void
    {
        $cover = $template['cover'];
        $c = ['alignment' => Jc::CENTER];
        if (!empty($cover['department'])) {
            $section->addText($cover['department'], ['bold' => true, 'size' => 14], $c + ['spaceBefore' => 480]);
        }
        $section->addText((string) $cover['program_text'], [], $c + ['spaceBefore' => 120]);

        $section->addText('Submitted to:', [], $c + ['spaceBefore' => 2400]);
        $section->addText($cover['submitted_to_name'] ?: '______________________', ['bold' => true, 'size' => 14], $c + ['spaceBefore' => 40]);
        if (!empty($cover['submitted_to_title'])) {
            $section->addText($cover['submitted_to_title'], [], $c);
        }

        $section->addText('Submitted By:', [], $c + ['spaceBefore' => 2400]);
        $section->addText($data['student']['name'] ?: '______________________', ['bold' => true], $c + ['spaceBefore' => 40]);

        $section->addText($cover['school_year'] ? "S.Y. {$cover['school_year']}" : '', ['bold' => true], $c + ['spaceBefore' => 2400]);
    }

    private function titlePage($section, array $data, array $template): void
    {
        $c = ['alignment' => Jc::CENTER];
        $place = implode(' AT ', array_filter([$data['department'] ?? null, $data['company']['name'] ?? null]));
        $bold = ['bold' => true];
        $section->addText('A NARRATIVE REPORT ON ON-THE-JOB TRAINING UNDERTAKEN AT ' . mb_strtoupper($place ?: '____________'), $bold, $c + ['pageBreakBefore' => true, 'spaceBefore' => 240]);
        $section->addText(mb_strtoupper((string) ($data['company']['name'] ?? '')), $bold, $c + ['spaceBefore' => 160]);
        if (!empty($data['company']['address'])) {
            $section->addText(mb_strtoupper($data['company']['address']), $bold, $c);
        }
        foreach ($data['deployment']['previous'] ?? [] as $p) {
            $section->addText((string) $p['label'], ['italic' => true, 'size' => 11], $c + ['spaceBefore' => 120]);
        }

        $seal = $this->prepareImage(resource_path('narrative/ched-logo.png'), 600);
        if ($seal) {
            [$w, $h] = $this->fit($seal['w'], $seal['h'], 2 * self::PT_PER_IN, 1.6 * self::PT_PER_IN);
            $section->addText('', [], $c + ['spaceBefore' => 1200]);
            $section->addImage($seal['path'], ['width' => $w, 'height' => $h, 'alignment' => Jc::CENTER]);
        }

        $section->addText($this->bachelorOf($data['student']['course'] ?? null), $bold, $c + ['spaceBefore' => 1200]);
        $section->addText('COMMISSION ON HIGHER EDUCATION', $bold, $c + ['spaceBefore' => 80]);
        $section->addText(self::CHED_ADDRESS, [], $c);

        $section->addText((string) $data['student']['name'], [], $c + ['spaceBefore' => 1200]);
        $section->addText($template['cover']['school_year'] ? "S.Y. {$template['cover']['school_year']}" : '', $bold, $c);
    }

    private function bachelorOf(?string $course): string
    {
        $c = trim((string) $course);
        if ($c === '') {
            return 'BACHELOR OF ______________________';
        }
        if (preg_match('/^(bachelor|b\.?\s?s\.?\s|b\.?\s?s\.?$|a\.?\s?b\.?\s)/i', $c)) {
            return mb_strtoupper($c);
        }

        return 'BACHELOR OF ' . mb_strtoupper($c);
    }

    private function toc($section, array $template): void
    {
        $section->addText('TABLE OF CONTENTS', ['bold' => true, 'size' => 14], ['alignment' => Jc::CENTER, 'pageBreakBefore' => true, 'spaceAfter' => 400]);
        $tab = new Tab('right', self::TEXT_WIDTH, 'dot');
        foreach ($template['sections'] as $i => $s) {
            $section->addText($s['title'] . "\t" . ($i + 1), ['bold' => true], ['tabs' => [$tab], 'spaceAfter' => 120]);
        }
    }

    // -------------------------------------------------------------- sections

    private function sectionBody($section, array $s, array $data, array $template): void
    {
        switch ($s['source']) {
            case 'intern_text':
                $this->paragraphs($section, ((array) $data['texts'])[$s['key']] ?? '');
                break;
            case 'document':
                $this->documentBody($section, $s, $data['documents'][$s['key']] ?? null);
                break;
            case 'auto_ledger':
                $this->ledger($section, $data['ledger']);
                break;
            case 'auto_attendance':
                $this->imageGrid($section, array_map(
                    fn ($p) => ['url' => $p['url'], 'lines' => [trim("{$p['date']} · {$p['time']}"), $p['kind']]],
                    $data['attendance_photos']
                ));
                break;
            case 'auto_duties':
                $this->duties($section, $data);
                break;
            case 'auto_photos':
                $photos = count($data['task_photos'])
                    ? array_map(fn ($p) => ['url' => $p['url'], 'lines' => [$p['caption']]], $data['task_photos'])
                    : array_map(fn ($p) => ['url' => $p['url'], 'lines' => ["{$p['kind']} — {$p['date']}, {$p['time']}"]], $data['attendance_photos']);
                $this->imageGrid($section, $photos);
                break;
            case 'auto_work_samples':
                $this->workSamples($section, $data['work_samples']);
                break;
            case 'auto_journal':
                $this->journal($section, $data);
                break;
            case 'auto_evaluation':
                $this->evaluation($section, $data['evaluation']);
                break;
            case 'fixed_text':
                $this->fixedText($section, $s, $data, $template);
                break;
        }
    }

    private function paragraphs($container, ?string $text): void
    {
        foreach (preg_split('/\n+/', (string) $text) as $line) {
            if (trim($line) !== '') {
                $container->addText($line, [], ['alignment' => Jc::BOTH, 'spaceAfter' => 200]);
            }
        }
    }

    private function documentBody($section, array $s, ?array $doc): void
    {
        if (!$doc) {
            return;
        }
        if ($doc['is_image']) {
            $img = $this->prepareImage($this->pathFromUrl($doc['file_url']), 1600);
            if ($img) {
                [$w, $h] = $this->fit($img['w'], $img['h'], 6 * self::PT_PER_IN, 8.5 * self::PT_PER_IN);
                $section->addImage($img['path'], ['width' => $w, 'height' => $h, 'alignment' => Jc::CENTER]);
            }

            return;
        }
        // PDF/DOC files can't be embedded.
        $table = $section->addTable(['borderSize' => 6, 'borderColor' => '000000', 'layout' => TableStyle::LAYOUT_FIXED, 'cellMargin' => 200]);
        $table->addRow(1800);
        $cell = $table->addCell(self::TEXT_WIDTH, ['valign' => 'center']);
        $run = $cell->addTextRun(['alignment' => Jc::CENTER]);
        $run->addText('Attached separately: ');
        $run->addText((string) $doc['file_name'], ['bold' => true]);
    }

    private function tableStyle(): array
    {
        return ['borderSize' => 6, 'borderColor' => '000000', 'layout' => TableStyle::LAYOUT_FIXED, 'cellMarginTop' => 40, 'cellMarginBottom' => 40, 'cellMarginLeft' => 100, 'cellMarginRight' => 100];
    }

    /** Header row (repeats on every page). */
    private function headerRow($table, array $widths, array $labels): void
    {
        $table->addRow(null, ['tblHeader' => true, 'cantSplit' => true]);
        foreach ($labels as $i => $label) {
            $table->addCell($widths[$i])->addText($label, ['bold' => true, 'size' => 11], ['alignment' => Jc::CENTER]);
        }
    }

    private function ledger($section, array $ledger): void
    {
        if (!$ledger['rows']) {
            return;
        }
        $multi = !empty($ledger['multi_company']);
        $w = $multi ? [1400, 1300, 1300, 900, 1240, 2500] : [1900, 1700, 1700, 1500, 1840];
        $table = $section->addTable($this->tableStyle());
        $this->headerRow($table, $w, array_merge(['DATE', 'TIME IN', 'TIME OUT', 'HOURS', 'TOTAL HOURS'], $multi ? ['COMPANY'] : []));
        foreach ($ledger['rows'] as $r) {
            $table->addRow(null, ['cantSplit' => true]);
            foreach (array_merge([$r['date'], $r['time_in'], $r['time_out'], $r['hours'], $r['running_total']], $multi ? [$r['company'] ?? ''] : []) as $i => $v) {
                $table->addCell($w[$i])->addText((string) $v, ['size' => 11], ['alignment' => Jc::CENTER]);
            }
        }
        $total = "Total hours rendered: {$ledger['total_hours']}" . ($ledger['required_hours'] ? " of {$ledger['required_hours']} required hours" : '');
        $section->addText($total, ['bold' => true], ['spaceBefore' => 240]);
    }

    /** 3-column grid of captioned images; rows never split across pages. */
    private function imageGrid($section, array $items): void
    {
        if (!$items) {
            return;
        }
        $table = $section->addTable(['borderSize' => 0, 'borderColor' => 'FFFFFF', 'layout' => TableStyle::LAYOUT_FIXED, 'cellMargin' => 60]);
        foreach (array_chunk($items, 3) as $row) {
            $table->addRow(null, ['cantSplit' => true]);
            for ($i = 0; $i < 3; $i++) {
                $cell = $table->addCell(2880, ['valign' => 'top']);
                $item = $row[$i] ?? null;
                if (!$item) {
                    $cell->addText('');
                    continue;
                }
                $img = $this->prepareImage($this->pathFromUrl($item['url']), 480);
                if ($img) {
                    [$w, $h] = $this->fit($img['w'], $img['h'], 1.9 * self::PT_PER_IN, 1.9 * self::PT_PER_IN);
                    $cell->addImage($img['path'], ['width' => $w, 'height' => $h, 'alignment' => Jc::CENTER]);
                }
                foreach ($item['lines'] as $line) {
                    $cell->addText((string) $line, ['size' => 10], ['alignment' => Jc::CENTER]);
                }
                $cell->addText('', ['size' => 6]);
            }
        }
    }

    private function duties($section, array $data): void
    {
        $section->addText($data['duties']['intro'], [], ['alignment' => Jc::BOTH, 'spaceAfter' => 200]);
        $section->addText('As trainee at ' . ($data['company']['name'] ?: 'the company') . ', I was assigned to:', [], ['spaceBefore' => 280, 'spaceAfter' => 120]);
        foreach ($data['duties']['tasks'] as $t) {
            $run = $section->addListItemRun(0, ['listType' => \PhpOffice\PhpWord\Style\ListItem::TYPE_BULLET_FILLED], ['spaceAfter' => 120]);
            $run->addText((string) $t['title'], ['bold' => true]);
            if (!empty($t['description'])) {
                $run->addText(' — ' . $t['description']);
            }
        }
    }

    private function workSamples($section, $items): void
    {
        foreach ($items as $item) {
            $section->addText((string) $item['title'], ['bold' => true], ['spaceBefore' => 240, 'spaceAfter' => 80, 'keepNext' => true]);
            $img = $this->prepareImage($this->pathFromUrl($item['image_url'] ?? null), 1200);
            if ($img) {
                [$w, $h] = $this->fit($img['w'], $img['h'], 6 * self::PT_PER_IN, 4 * self::PT_PER_IN);
                $section->addImage($img['path'], ['width' => $w, 'height' => $h, 'borderSize' => 6, 'borderColor' => '000000']);
            }
            if (!empty($item['description'])) {
                foreach (preg_split('/\n/', $item['description']) as $line) {
                    $section->addText($line, [], ['spaceBefore' => 60]);
                }
            }
            if (!empty($item['project_url'])) {
                $section->addText((string) $item['project_url'], ['size' => 10], ['spaceBefore' => 40]);
            }
        }
    }

    private function journal($section, array $data): void
    {
        $student = $data['student'];
        $u = ['underline' => 'single'];
        $t = $section->addTable(['borderSize' => 0, 'borderColor' => 'FFFFFF', 'layout' => TableStyle::LAYOUT_FIXED, 'cellMargin' => 0]);
        $pairs = [
            [['Name: ', $student['name']], ['Name of Company: ', $data['company']['name']]],
            [['Degree Program: ', $student['course']], ['Department: ', $data['department']]],
        ];
        foreach ($pairs as $pair) {
            $t->addRow();
            foreach ($pair as [$label, $value]) {
                $run = $t->addCell(self::TEXT_WIDTH / 2)->addTextRun(['spaceAfter' => 60]);
                $run->addText($label);
                $run->addText((string) ($value ?? ''), $u);
            }
        }
        $section->addText(
            'Instruction: Describe briefly task performed during the day. State the nature of the work performed, lessons learned, challenges hurdles and other insights.',
            ['bold' => true],
            ['spaceBefore' => 280, 'spaceAfter' => 280]
        );

        $w = [1450, 1300, 1050, 1050, 3790];
        $table = $section->addTable($this->tableStyle());
        $this->headerRow($table, $w, ['DATE', 'DAY', 'AM', 'PM', 'DAILY SCHEDULE']);
        if (!$data['journal']) {
            $table->addRow(1440);
            $table->addCell(self::TEXT_WIDTH, ['gridSpan' => 5])->addText('');
        }
        foreach ($data['journal'] as $r) {
            $table->addRow(null, ['cantSplit' => true]);
            foreach ([$r['date'], $r['day'], $r['am'], $r['pm']] as $i => $v) {
                $table->addCell($w[$i])->addText((string) $v, ['size' => 11]);
            }
            $cell = $table->addCell($w[4]);
            if (!empty($r['company'])) {
                $cell->addText('At ' . $r['company'], ['size' => 9, 'italic' => true]);
            }
            $lines = preg_split('/\n/', (string) $r['schedule']);
            foreach ($lines as $line) {
                $cell->addText($line, ['size' => 11]);
            }
        }
    }

    private function evaluation($section, ?array $e): void
    {
        if (!$e) {
            return;
        }
        $groups = [];
        foreach ($e['scores'] as $s) {
            $groups[$s['category'] ?? ''][] = $s;
        }
        if ($groups) {
            $w = [6240, 1200, 1200];
            $table = $section->addTable($this->tableStyle());
            $this->headerRow($table, $w, ['CRITERIA', 'SCORE', 'MAX']);
            foreach ($groups as $cat => $rows) {
                if ($cat !== '') {
                    $table->addRow(null, ['cantSplit' => true]);
                    $table->addCell(self::TEXT_WIDTH, ['gridSpan' => 3])->addText((string) $cat, ['bold' => true, 'size' => 11]);
                }
                foreach ($rows as $r) {
                    $table->addRow(null, ['cantSplit' => true]);
                    $table->addCell($w[0])->addText((string) $r['criterion_name'], ['size' => 11]);
                    $table->addCell($w[1])->addText((string) $r['score'], ['size' => 11], ['alignment' => Jc::CENTER]);
                    $table->addCell($w[2])->addText((string) $r['max_score'], ['size' => 11], ['alignment' => Jc::CENTER]);
                }
            }
        }
        $rating = $e['overall_score'] !== null ? "{$e['overall_score']}%" : '—';
        $section->addText("Total / Rating: {$rating}", ['bold' => true], ['spaceBefore' => 280]);
        if (!empty($e['remarks'])) {
            $section->addText("Remarks: {$e['remarks']}", [], ['alignment' => Jc::BOTH, 'spaceBefore' => 120]);
        }
        $by = 'Evaluated by: ' . ($e['evaluator_name'] ?: '—') . ($e['evaluation_date'] ? " · {$e['evaluation_date']}" : '');
        $section->addText($by, [], ['spaceBefore' => 200]);
    }

    private function fixedText($section, array $s, array $data, array $template): void
    {
        $this->paragraphs($section, $s['body'] ?? '');
        $c = ['alignment' => Jc::CENTER];
        $bold = ['bold' => true];
        if (!empty($s['signatures'])) {
            $coordinator = $data['coordinator']['name'] ?: '______________________';
            $section->addText((string) $template['letterhead']['school_name'], [], $c + ['spaceBefore' => 600, 'keepNext' => true]);
            $section->addText('', ['size' => 8], ['indentation' => ['left' => 2880, 'right' => 2880], 'borderBottomSize' => 6, 'borderBottomColor' => '000000', 'spaceBefore' => 600, 'keepNext' => true]);
            $section->addText(mb_strtoupper($coordinator), $bold, $c + ['keepNext' => true]);
            $section->addText($data['coordinator']['title'] ?: 'OJT Coordinator', $bold, $c + ['keepNext' => true]);
            $section->addText('Date: ____________', $bold, $c + ['keepNext' => true]);

            $t = $section->addTable(['borderSize' => 0, 'borderColor' => 'FFFFFF', 'layout' => TableStyle::LAYOUT_FIXED, 'cellMargin' => 0]);
            $t->addRow(1000);
            $t->addCell(4000, ['valign' => 'bottom', 'borderBottomSize' => 6, 'borderBottomColor' => '000000']);
            $t->addCell(640);
            $t->addCell(4000, ['valign' => 'bottom', 'borderBottomSize' => 6, 'borderBottomColor' => '000000']);
            $t->addRow();
            foreach ([4000 => 'Student', 640 => null, 4001 => 'Parent/Guardian'] as $width => $label) {
                $cell = $t->addCell($width > 4000 ? 4000 : $width);
                if ($label) {
                    $cell->addText($label, $bold, $c);
                    $cell->addText('Date: __________', $bold, $c);
                }
            }
        }
        if (!empty($s['remarks'])) {
            $section->addText('REMARKS', [], ['spaceBefore' => 560, 'keepNext' => true]);
            $section->addText($s['remarks'], [], ['alignment' => Jc::BOTH, 'indentation' => ['firstLine' => 720]]);
        }
    }

    // ---------------------------------------------------------------- images

    /** Public storage URL (as emitted by NarrativeReportService) -> local file path, if it exists. */
    private function pathFromUrl(?string $url): ?string
    {
        if (!$url) {
            return null;
        }
        $disk = Storage::disk('public');
        $base = $disk->url('');
        $relative = str_starts_with($url, $base) ? substr($url, strlen($base)) : null;
        if ($relative === null) {
            return null;
        }
        $relative = urldecode($relative);
        if ($relative === '' || str_contains($relative, '..') || !$disk->exists($relative)) {
            return null;
        }

        return $disk->path($relative);
    }

    /**
     * Return ['path','w','h'] for an embeddable image, downsized to $maxPx
     * wide (re-encoded as JPEG) when larger or in a format Word can't take
     * (webp). Null when the file is missing or unreadable.
     */
    private function prepareImage(?string $path, int $maxPx): ?array
    {
        if (!$path || !is_file($path)) {
            return null;
        }
        $info = @getimagesize($path);
        if (!$info) {
            return null;
        }
        [$w, $h, $type] = $info;
        $native = in_array($type, [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_GIF], true);
        if ($native && $w <= $maxPx) {
            return ['path' => $path, 'w' => $w, 'h' => $h];
        }
        if (!function_exists('imagecreatefromstring')) {
            return $native ? ['path' => $path, 'w' => $w, 'h' => $h] : null;
        }
        $src = @imagecreatefromstring((string) file_get_contents($path));
        if (!$src) {
            return $native ? ['path' => $path, 'w' => $w, 'h' => $h] : null;
        }
        $nw = min($w, $maxPx);
        $nh = max(1, (int) round($h * $nw / $w));
        $dst = imagecreatetruecolor($nw, $nh);
        imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
        $jpeg = function_exists('imagejpeg');
        $out = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'nr_' . uniqid('', true) . ($jpeg ? '.jpg' : '.png');
        $ok = $jpeg ? imagejpeg($dst, $out, 82) : imagepng($dst, $out, 6);
        if (!$ok) {
            return $native ? ['path' => $path, 'w' => $w, 'h' => $h] : null;
        }
        $this->tempFiles[] = $out;

        return ['path' => $out, 'w' => $nw, 'h' => $nh];
    }

    /** Scale (w,h) down to fit inside the box, keeping the aspect ratio; points. */
    private function fit(int $w, int $h, float $maxW, float $maxH): array
    {
        $scale = min($maxW / max(1, $w), $maxH / max(1, $h));

        return [round($w * $scale, 1), round($h * $scale, 1)];
    }
}
