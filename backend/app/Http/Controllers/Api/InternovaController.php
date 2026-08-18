<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Company;
use App\Models\InternshipDeployment;
use App\Models\School;
use Illuminate\Http\JsonResponse;

class InternovaController extends Controller
{
    public function schools(): JsonResponse
    {
        return response()->json([
            'data' => School::query()->orderBy('school_name')->get(),
        ]);
    }

    public function companies(): JsonResponse
    {
        return response()->json([
            'data' => Company::query()->orderBy('company_name')->get(),
        ]);
    }

    public function deployments(): JsonResponse
    {
        return response()->json([
            'data' => InternshipDeployment::query()->with(['intern', 'company', 'coordinator', 'supervisor'])->orderBy('created_at', 'desc')->get(),
        ]);
    }
}
