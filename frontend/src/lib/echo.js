"use client";

import Echo from "laravel-echo";
import Pusher from "pusher-js";

let echoInstance = null;

/**
 * One shared Reverb/Echo connection per browser tab. Public channels only —
 * this app has no real session/token auth (see backend AuthController), so
 * there's nothing to authorize a private channel with. See routes/channels.php
 * on the backend for the same note.
 */
export function getEcho() {
  if (typeof window === "undefined") return null;

  if (!echoInstance) {
    window.Pusher = Pusher;
    echoInstance = new Echo({
      broadcaster: "reverb",
      key: process.env.NEXT_PUBLIC_REVERB_APP_KEY,
      wsHost: process.env.NEXT_PUBLIC_REVERB_HOST,
      wsPort: Number(process.env.NEXT_PUBLIC_REVERB_PORT ?? 8080),
      wssPort: Number(process.env.NEXT_PUBLIC_REVERB_PORT ?? 8080),
      forceTLS: (process.env.NEXT_PUBLIC_REVERB_SCHEME ?? "http") === "https",
      enabledTransports: ["ws", "wss"],
    });
  }

  return echoInstance;
}
