"use client";

import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** Uploads a File to the given public bucket ("logos" or "subjects") and
 *  returns its public URL, ready to store on the school/subject row. */
export async function uploadImage(bucket: "logos" | "subjects", file: File): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error("Le fichier est trop volumineux (maximum 10 Mo).");
  }

  const supabase = createClient();
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
