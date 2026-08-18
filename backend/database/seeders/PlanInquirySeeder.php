<?php

namespace Database\Seeders;

use App\Models\PlanInquiry;
use Illuminate\Database\Seeder;

class PlanInquirySeeder extends Seeder
{
    public function run(): void
    {
        $inquiries = [
            [
                'school_name'           => 'PMFTCI',
                'school_type'           => 'Technical/Vocational',
                'address'               => 'Poblacion, Maasin City, Southern Leyte',
                'contact_person'        => 'Juan Dela Cruz',
                'position'              => 'OJT Program Coordinator',
                'email'                 => 'ojt@pmftci.edu.ph',
                'phone'                 => '09171234567',
                'intern_range'          => '101 – 200',
                'expected_coordinators' => '4',
                'interested_plan'       => 'Premium',
                'heard_from'            => 'Social Media',
                'message'               => 'Good day! We are interested in your platform for our OJT management. We handle around 150 interns per semester. We would like to request a demo and a formal quotation.',
                'status'                => 'new',
                'notes'                 => null,
            ],
            [
                'school_name'           => 'ABC College of Technology',
                'school_type'           => 'Private College',
                'address'               => 'Brgy. Poblacion, Cebu City',
                'contact_person'        => 'Maria Santos',
                'position'              => 'Dean of Students',
                'email'                 => 'dean@abcollege.edu.ph',
                'phone'                 => '09281234567',
                'intern_range'          => '50 – 100',
                'expected_coordinators' => '2',
                'interested_plan'       => 'Not sure — I need more info',
                'heard_from'            => 'Referral from another school',
                'message'               => 'We saw your platform mentioned by another school. We want to understand the pricing and features better before committing.',
                'status'                => 'contacted',
                'notes'                 => 'Called on Aug 9. Scheduled follow-up call on Aug 15.',
            ],
            [
                'school_name'           => 'XYZ State University',
                'school_type'           => 'State University/College',
                'address'               => 'University Drive, Davao City',
                'contact_person'        => 'Dr. Roberto Lim',
                'position'              => 'VP for Academic Affairs',
                'email'                 => 'vpaa@xyzsu.edu.ph',
                'phone'                 => '09391234567',
                'intern_range'          => 'More than 500',
                'expected_coordinators' => '10',
                'interested_plan'       => 'Premium Plan',
                'heard_from'            => 'Conference / CHED Event',
                'message'               => 'We met your team at the CHED conference. We are interested in a large-scale deployment. Please prepare a proposal.',
                'status'                => 'under_discussion',
                'notes'                 => 'Proposal draft sent on Aug 8. Awaiting approval from their administration.',
            ],
        ];

        foreach ($inquiries as $data) {
            PlanInquiry::firstOrCreate(['email' => $data['email']], $data);
        }
    }
}
