<?php

// Notifications broadcast on PUBLIC channels (school.{id}.{role}-notifications,
// superadmin-notifications, user.{id}-notifications) — see App\Events\NotificationCreated.
// Public channels need no entry here; Broadcast::channel() is only for private/presence
// channels, which this app can't authorize since there's no real session/token auth yet.
