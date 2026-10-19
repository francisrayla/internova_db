<?php

namespace App\Support;

/**
 * Plain-language validation messages for a file field, so people never see
 * "The file field must be a file of type: jpg, jpeg, png, pdf, doc, docx.".
 * The rules stay as they are; pass the result as the second argument of validate().
 *
 *   $request->validate($rules, UploadMessages::for('file', 'JPG, PNG, PDF, DOC or DOCX', 10));
 */
class UploadMessages
{
    /**
     * @param  string  $field  the rule key, e.g. 'file', 'photo' or 'proofs.*'
     * @param  string  $kinds  readable list of accepted types, e.g. 'JPG, PNG, PDF, DOC or DOCX'
     * @param  int  $maxMb  largest size in megabytes (match the `max` rule)
     * @param  string  $noun  what the person is uploading, for the size message
     */
    public static function for(string $field, string $kinds, int $maxMb, string $noun = 'file'): array
    {
        $choose = "Choose a {$kinds} file.";

        return [
            "{$field}.mimes" => $choose,
            "{$field}.image" => $choose,
            "{$field}.file" => 'Choose a file to upload.',
            "{$field}.required" => 'Choose a file to upload.',
            "{$field}.max" => "The {$noun} must be {$maxMb} MB or smaller.",
            "{$field}.uploaded" => "The {$noun} could not be uploaded. Make sure it is {$maxMb} MB or smaller and try again.",
        ];
    }
}
