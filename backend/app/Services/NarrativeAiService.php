<?php

namespace App\Services;

use App\Models\AiUsageLog;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Text-only AI help for intern narratives, backed by Google's Gemini API:
 *
 * - polish(): rewrites an intern's own daily log as a formal OJT narrative —
 *   one or two developed paragraphs ending in a short reflection — and
 *   translates Filipino/Taglish into English, without inventing facts. A suggestion the intern can accept or
 *   ignore (see InternMonitoringController::polishNarrative).
 * - generateFromTasking(): drafts a short placeholder narrative for a day
 *   the intern attended but never logged, from their attendance times and
 *   completed tasks only.
 *
 * Both return null on any failure (missing key, quota reached, network
 * error, retired model, cut-off answer) so the caller falls back to saving
 * as written / a plain template — AI being down never blocks an intern.
 * Every call is recorded in ai_usage_logs for the Super Admin's AI Usage view.
 */
class NarrativeAiService
{
    // A small, fast, non-"thinking" model is plenty for 1–3 sentences of
    // rewriting. If Google retires it, the -latest alias keeps things running
    // until GEMINI_MODEL is updated.
    private const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
    private const FALLBACK_MODEL = 'gemini-flash-lite-latest';

    public static function isConfigured(): bool
    {
        return filled(config('services.gemini.api_key'));
    }

    public static function model(): string
    {
        return config('services.gemini.model') ?: self::DEFAULT_MODEL;
    }

    public static function polish(string $draft, ?int $schoolId = null, ?int $userId = null): ?string
    {
        $draft = trim($draft);
        if ($draft === '') {
            return null;
        }

        $prompt = <<<PROMPT
        You are an editor helping a student intern in the Philippines turn a rough daily log into a formal entry for their On-the-Job Training (OJT) narrative report — the document their school and host company will read.

        The draft may be in English, Filipino/Tagalog, or Taglish. Always write the result in English.

        Write it as a formal OJT narrative:
        - First person ("I", or "we" when the draft describes a group), past tense, professional and academic in tone.
        - One or two well-developed paragraphs, about 90–160 words in total, with varied sentence openings (do not start consecutive sentences with the same words).
        - Follow this flow: what happened and what was assigned; how the work was carried out, step by step, using only the details in the draft; then one or two closing sentences on what the experience developed or taught (for example, attention to detail, organization, following instructions, teamwork) — phrased as reflection, not as new events.

        Accuracy rules — these matter more than length:
        - Keep the exact meaning of every term. Do not reinterpret words (for example, "grades" stays grades — never "documents", "files" or "records").
        - Do not add tasks, tools, software, people, names, numbers or results that the draft does not mention. If the draft is short, elaborate by explaining the stated steps more clearly, not by inventing new ones.
        - Refer to whoever gave instructions in neutral English (e.g. "maam"/"sir" → "our supervisor").

        Return only the finished narrative — no title, label, preamble or quotation marks.

        Draft:
        {$draft}
        PROMPT;

        return self::generate($prompt, 0.4, 900, AiUsageLog::POLISH, $schoolId, $userId);
    }

    /**
     * @param array<int, string> $items Titles of tasks/subtasks completed that date.
     */
    public static function generateFromTasking(array $items, ?string $clockIn, ?string $clockOut, ?int $schoolId = null, ?int $userId = null): ?string
    {
        $worked = $items === [] ? 'No specific tasks were marked completed on this date.' : 'Completed: ' . implode(', ', $items) . '.';
        $hours = ($clockIn && $clockOut) ? "Present from {$clockIn} to {$clockOut}." : 'Attendance was logged for this date.';

        $prompt = <<<PROMPT
        Write a formal daily entry for a student intern's On-the-Job Training (OJT) narrative report in the Philippines, based ONLY on the facts below. Use first person, past tense, and a professional, academic tone, in 3–4 sentences: state the attendance period, describe the completed work using exactly the task names given, and close with one sentence of reflection on the skills the work involved. Do not invent any task, tool, person, number or outcome that is not listed. This is a placeholder the intern can still edit. Return only the narrative text.

        {$hours}
        {$worked}
        PROMPT;

        return self::generate($prompt, 0.3, 500, AiUsageLog::DRAFT, $schoolId, $userId);
    }

    /** One Gemini call, retried once on the fallback model if the configured
     *  one has been retired. The key goes in a header, never the URL, so it
     *  can't end up in access logs. */
    private static function generate(string $prompt, float $temperature, int $maxTokens, string $feature, ?int $schoolId, ?int $userId): ?string
    {
        $apiKey = config('services.gemini.api_key');
        if (!$apiKey) {
            return null;
        }

        $models = array_values(array_unique([self::model(), self::FALLBACK_MODEL]));
        $text = null;
        $usedModel = $models[0];

        foreach ($models as $model) {
            $usedModel = $model;
            try {
                $response = Http::timeout(20)
                    ->withHeaders(['x-goog-api-key' => $apiKey])
                    ->post("https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent", [
                        'contents' => [['parts' => [['text' => $prompt]]]],
                        'generationConfig' => ['temperature' => $temperature, 'maxOutputTokens' => $maxTokens],
                    ]);
            } catch (Throwable $e) {
                Log::warning('Gemini request threw.', ['model' => $model, 'error' => $e->getMessage()]);
                break;
            }

            // 404, or a 400 saying the model is gone: try the fallback model.
            $retired = $response->status() === 404
                || ($response->status() === 400 && str_contains((string) $response->json('error.message'), 'no longer available'));
            if ($retired) {
                Log::warning('Gemini model unavailable, trying fallback.', ['model' => $model]);
                continue;
            }

            if (!$response->successful()) {
                Log::warning('Gemini request failed.', ['model' => $model, 'status' => $response->status(), 'body' => $response->body()]);
                break;
            }

            // A reply cut off at the token limit would read as a broken
            // sentence in the intern's log — treat it as no answer.
            if ($response->json('candidates.0.finishReason') !== 'STOP') {
                Log::warning('Gemini reply incomplete.', ['model' => $model, 'finish' => $response->json('candidates.0.finishReason')]);
                break;
            }

            $candidate = $response->json('candidates.0.content.parts.0.text');
            $candidate = is_string($candidate) ? trim($candidate, " \t\n\r\"") : '';
            $text = $candidate !== '' ? $candidate : null;
            break;
        }

        try {
            AiUsageLog::create([
                'school_id' => $schoolId,
                'user_id' => $userId,
                'feature' => $feature,
                'model' => $usedModel,
                'succeeded' => $text !== null,
            ]);
        } catch (Throwable $e) {
            // Usage tracking must never break the feature itself.
            Log::warning('Could not record AI usage.', ['error' => $e->getMessage()]);
        }

        return $text;
    }
}
