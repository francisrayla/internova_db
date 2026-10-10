"use client";

import Echo from "laravel-echo";
import Pusher from "pusher-js";

const TOKEN_KEY = "internova_token";

let echoInstance = null;
let echoToken = null;

function currentToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * One shared Reverb/Echo connection per browser tab. Every channel is PRIVATE: each subscription is
 * authorized at /api/broadcasting/auth (our Next.js proxy, which forwards the signed-in user's Bearer
 * token to Laravel's POST /api/broadcasting/auth; routes/channels.php on the backend decides who may
 * listen). Use echo.private("user.<id>.notifications") — never echo.channel() — and never include a
 * "private-" prefix yourself.
 *
 * The connection belongs to whoever was signed in when it was created: if the token has changed
 * since (logout/login in the same tab), the old connection is dropped and a fresh one is made so a
 * previous user's private subscriptions never carry over.
 */
export function getEcho() {
  if (typeof window === "undefined") return null;

  const token = currentToken();
  if (!token) return null;

  if (echoInstance && echoToken !== token) disconnectEcho();

  if (!echoInstance) {
    window.Pusher = Pusher;
    echoToken = token;
    echoInstance = new Echo({
      broadcaster: "reverb",
      key: process.env.NEXT_PUBLIC_REVERB_APP_KEY,
      wsHost: process.env.NEXT_PUBLIC_REVERB_HOST,
      wsPort: Number(process.env.NEXT_PUBLIC_REVERB_PORT ?? 8080),
      wssPort: Number(process.env.NEXT_PUBLIC_REVERB_PORT ?? 8080),
      forceTLS: (process.env.NEXT_PUBLIC_REVERB_SCHEME ?? "http") === "https",
      enabledTransports: ["ws", "wss"],
      channelAuthorization: {
        endpoint: "/api/broadcasting/auth",
        transport: "ajax",
        headersProvider: () => {
          const t = currentToken();
          return t ? { Authorization: `Bearer ${t}`, Accept: "application/json" } : { Accept: "application/json" };
        },
      },
    });
  }

  return echoInstance;
}

/** Drop the realtime connection (called on logout, or when the signed-in user changes). */
export function disconnectEcho() {
  if (echoInstance) {
    try {
      echoInstance.disconnect();
    } catch {
      // already closed
    }
  }
  echoInstance = null;
  echoToken = null;
}
