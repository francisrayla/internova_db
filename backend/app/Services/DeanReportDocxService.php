<?php

namespace App\Services;

use Illuminate\Support\Carbon;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Settings;
use PhpOffice\PhpWord\SimpleType\Jc;

/**
 * "School monitoring report" for the Dean as a Word file: cover, summary,
 * status groups, intern table, coordinator scorecard + setup checklist and
 * the last 4 weeks of coordinator activity. Built from the same payloads the
 * Dean screens use, so numbers never differ from what is on screen.
 */
class DeanReportDocxService
{
    private const WIDTH = 14400; // landscape letter, 0.5in margins

    private PhpWord $word;

    /** @param array{school:\App\Models\School,generated_at:Carbon,rows:\Illuminate\Support\Collection,groups:array,scorecard:array,checklist:array,activity:array,coordinator:?string} $d */
    public static function build(array $d): string
    {
        return (new self())->make($d);
    }

    private function make(array $d): string
    {
        Settings::setOutputEscapingEnabled(true);
        $this->word = new PhpWord();
        $this->word->setDefaultFontName('Arial');
        $this->word->setDefaultFontSize(10);
        $this->word->setDefaultParagraphStyle(['spaceAfter' => 80, 'spaceBefore' => 0]);

        $school = $d['school'];
        $from = Carbon::parse($d['activity']['days'][0]['date']);
        $to = $d['generated_at']->copy()->startOfDay();
        $range = $from->format('M j, Y') . ' to ' . $to->format('M j, Y');

        $s = $this->word->addSection([
            'orientation' => 'landscape', 'pageSizeW' => 15840, 'pageSizeH' => 12240,
            'marginTop' => 720, 'marginBottom' => 720, 'marginLeft' => 720, 'marginRight' => 720,
        ]);
        $footer = $s->addFooter();
        $footer->addPreserveText($school->school_name . ' - monitoring report - page {PAGE} of {NUMPAGES}', ['size' => 8, 'color' => '64748B'], ['alignment' => Jc::CENTER]);

        // Cover
        $s->addTextBreak(6);
        $s->addText($school->school_name, ['bold' => true, 'size' => 28], ['alignment' => Jc::CENTER, 'spaceAfter' => 200]);
        $s->addText('OJT Monitoring Report', ['size' => 20, 'color' => '2563EB'], ['alignment' => Jc::CENTER, 'spaceAfter' => 200]);
        $s->addText($range, ['size' => 13], ['alignment' => Jc::CENTER, 'spaceAfter' => 80]);
        $s->addText('Prepared ' . $d['generated_at']->format('F j, Y') . ($d['coordinator'] ? ' - Coordinator: ' . $d['coordinator'] : ''), ['size' => 10, 'color' => '64748B'], ['alignment' => Jc::CENTER]);
        $s->addPageBreak();

        // Summary
        $rows = $d['rows']->where('status', '!=', 'inactive');
        $g = $d['groups'];
        $hours = round($rows->sum('hours_completed'), 1);
        $this->heading($s, 'Summary');
        $s->addText("This report covers {$g['total']} " . ($g['total'] === 1 ? 'intern' : 'interns') . " at {$school->school_name}. Together they have rendered {$hours} approved hours. "
            . "{$g['at_risk']} " . ($g['at_risk'] === 1 ? 'is' : 'are') . " at risk and {$g['needs_attention']} need" . ($g['needs_attention'] === 1 ? 's' : '') . ' attention.');

        $this->heading($s, 'Status groups');
        $this->table($s, ['Group', 'Interns', 'What it means'], [
            ['At risk', $g['at_risk'], 'Projected to finish after the end date, no clock-in for 5 working days, or 2 or more problems.'],
            ['Needs attention', $g['needs_attention'], 'One problem to look at (no recent clock-in, behind on hours, missing documents or evaluation due).'],
            ['On track', $g['on_track'], 'No problems found.'],
            ['Completed', $g['completed'], 'Deployment completed or the required hours are already met.'],
        ], [2600, 1400, 10400]);

        // Interns
        $this->heading($s, 'Interns');
        $table = [];
        foreach ($rows as $r) {
            $table[] = [
                $r['intern_name'] ?? '-',
                $r['status_group_label'],
                $r['hours_completed'] . ' / ' . $r['required_hours'] . ' h',
                $r['projection']['label'] . ($r['projection']['note'] ? ' (' . $r['projection']['note'] . ')' : ''),
                $r['last_clock_in_at'] ? \App\Support\LocalTime::format($r['last_clock_in_at'], 'M j, Y') : 'Never',
                $r['narrative_total'] ? $r['narrative_done'] . ' of ' . $r['narrative_total'] : '-',
                $r['latest_evaluation_score'] !== null ? (string) $r['latest_evaluation_score'] : ($r['has_evaluation'] ? 'Done' : 'None yet'),
            ];
        }
        $table ? $this->table($s, ['Intern', 'Status', 'Hours', 'Projected finish', 'Last clock-in', 'Narrative', 'Evaluation'], $table, [2400, 1500, 1700, 4300, 1700, 1300, 1500])
            : $s->addText('No interns yet.');

        // Coordinator
        $s->addPageBreak();
        $this->heading($s, 'Coordinator scorecard');
        $rowsC = [];
        foreach ($d['scorecard']['metrics'] as $m) {
            $rowsC[] = [$m['title'], $m['display'], $m['verdict']['label'], $m['detail']];
        }
        $this->table($s, ['Measure', 'Result', 'Verdict', 'Details'], $rowsC, [3200, 2000, 1800, 7400]);
        $s->addText($d['scorecard']['help']['review_time'], ['size' => 8, 'color' => '64748B']);

        $this->heading($s, "Setup checklist ({$d['checklist']['done']} of {$d['checklist']['total']})");
        $this->table($s, ['Step', 'Done', 'Note'], array_map(fn ($i) => [$i['label'], $i['ok'] ? 'Yes' : 'Not yet', $i['hint']], $d['checklist']['items']), [5400, 1400, 7600]);

        $this->heading($s, 'Coordinator activity, last 4 weeks');
        $a = $d['activity'];
        $this->table($s, ['Week', 'Actions'], array_map(fn ($w) => [$w['label'], $w['total']], $a['weeks']), [6000, 2000]);
        $s->addText("This week {$a['this_week']}, last week {$a['last_week']}.");

        $path = tempnam(sys_get_temp_dir(), 'dnrep');
        IOFactory::createWriter($this->word, 'Word2007')->save($path);

        return $path;
    }

    private function heading($section, string $text): void
    {
        $section->addText($text, ['bold' => true, 'size' => 14, 'color' => '1E3A8A'], ['spaceBefore' => 240, 'spaceAfter' => 120, 'keepNext' => true]);
    }

    /** @param array<int,string> $head  @param array<int,array<int,mixed>> $body  @param array<int,int> $widths */
    private function table($section, array $head, array $body, array $widths): void
    {
        $t = $section->addTable(['borderSize' => 4, 'borderColor' => 'CBD5E1', 'cellMargin' => 60, 'width' => self::WIDTH, 'unit' => 'dxa']);
        $t->addRow(null, ['tblHeader' => true]);
        foreach ($head as $i => $h) {
            $t->addCell($widths[$i], ['bgColor' => 'E2E8F0'])->addText($h, ['bold' => true, 'size' => 9]);
        }
        foreach ($body as $row) {
            $t->addRow();
            foreach ($row as $i => $cell) {
                $t->addCell($widths[$i])->addText((string) $cell, ['size' => 9]);
            }
        }
        $section->addTextBreak(0);
    }
}
