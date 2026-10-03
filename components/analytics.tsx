"use client";

import { Analytics as VercelAnalytics } from "@vercel/analytics/next";

const OWNER_FLAG = "ce-owner";

/**
 * True in a browser the site owner has marked as theirs, by running
 *   localStorage.setItem("ce-owner", "1")
 * once in the console. A demo with a handful of real visitors is easily drowned out by
 * its author checking that it still works, so the owner's page views are dropped and
 * their extraction attempts are tagged for exclusion.
 */
export function isOwner(): boolean {
  try {
    return window.localStorage.getItem(OWNER_FLAG) === "1";
  } catch {
    return false; // storage blocked (private mode, strict settings): treat as a visitor
  }
}

/** Cookieless page views and referrers, minus the owner's own visits. */
export function Analytics() {
  return <VercelAnalytics beforeSend={(event) => (isOwner() ? null : event)} />;
}
