<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AttendanceCapture extends Model
{
    protected $fillable = ['attendance_id', 'capture_type', 'selfie_path', 'proof_image_path', 'latitude', 'longitude', 'gps_accuracy', 'location_address', 'distance_from_company', 'within_allowed_area', 'verified', 'verification_note', 'captured_at', 'verified_at'];
}
