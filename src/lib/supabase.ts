// ------------------------------------------------------------------------------
// Supabase client — payment-proof uploads (ADR-0011).
//
// Supabase Storage hosts the `payment-proofs` bucket: the only place a Guest's
// downpayment screenshot lands in cloud mode. Why Supabase rather than Firebase
// Storage, and why the path (not a signed URL) is what the Booking records, is
// written up in docs/adr/ADR-0011-supabase-storage.md.
//
// Configuration comes from VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY. With
// either missing the app is in demo mode for uploads: the client stays null and
// callers fall back to this browser's own storage rather than failing over
// silently or stranding a receipt nowhere (see lib/storage.ts).
// ------------------------------------------------------------------------------
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** The single bucket payment proofs are uploaded to. */
export const PAYMENT_PROOFS_BUCKET = 'payment-proofs'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when both Supabase environment variables are present and non-empty. */
export const isSupabaseConfigured: boolean = Boolean(url && anonKey)

/**
 * The Supabase client, or null in demo mode (no keys).
 *
 * Built once at module load; module consumers (helpers, tests) import `supabase`
 * rather than calling createClient themselves.
 */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null
