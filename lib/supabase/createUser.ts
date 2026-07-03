"use client";

import { createClient } from "@/lib/supabase/client";

export interface CreateUserPayload {
  role: "admin" | "reception" | "teacher" | "student" | "parent";
  email: string;
  password: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  birthDate?: string;
  rfid?: string;
  isFree?: boolean;
  parentId?: string;
  subscriptionIds?: string[];
  registrationDue?: number;
  paymentType?: string;
  monthlyAmount?: number;
  startDate?: string;
  percentage?: number;
  salary?: number;
}

/** Creates a Supabase Auth login + the matching role-specific row via the
 *  server-side admin route. Throws with a human-readable message on failure. */
export async function createRoleUser(payload: CreateUserPayload): Promise<{ id: string }> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Impossible de créer le compte.");
  return { id: body.id as string };
}

/** Admin/reception resets someone else's password. */
export async function resetUserPassword(id: string, password: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error ?? "Impossible de modifier le mot de passe.");
  }
}

/** Self-service password change for the currently signed-in user. */
export async function changeOwnPassword(password: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}
