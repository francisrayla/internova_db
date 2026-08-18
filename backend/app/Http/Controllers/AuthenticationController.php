<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Routing\Controller as BaseController;

class AuthenticationController extends BaseController
{
    public function login(Request $request)
    {
        return response()->json(['message' => 'Authentication endpoint ready']);
    }
}
