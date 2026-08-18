"use client";

import { createContext, useContext } from "react";

// Lets a page nested under a role layout (e.g. /intern/profile) read the
// same `user` object the layout's header renders, and push updates back to
// it (e.g. after an avatar change) without a full reload — the layout
// instance stays mounted across navigations within its section, so this
// context just exposes the state it already owns instead of duplicating it.
export const UserContext = createContext({ user: null, onUserUpdated: () => {} });

export function useCurrentUser() {
  return useContext(UserContext);
}
