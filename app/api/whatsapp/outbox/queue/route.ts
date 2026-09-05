import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import { WhatsAppError } from "@/lib/whatsapp/client";
import { type QueueEntry, queueMessages, withoutQueuedDuplicates } from "@/lib/whatsapp/outbox";
import { normalizePhone } from "@/lib/whatsapp/phone";
import { MAX_MESSAGE_LENGTH } from "@/lib/whatsapp/templates";

/** DÉPOSER une alerte, sans jamais l'envoyer.
 *
 *  POURQUOI CETTE ROUTE N'APPELLE PAS LA PASSERELLE — c'est tout son intérêt
 *  ---------------------------------------------------------------------------
 *  Elle est appelée depuis le scan d'une carte. À ce moment-là, la seule chose
 *  qui compte est que la réception voie le verdict du badge instantanément.
 *  Interroger la passerelle ajoutait un aller-retour réseau à chaque scan, et
 *  quand elle ne répondait pas, l'échec remontait en bandeau sur tous les
 *  écrans — pour un message que personne n'avait demandé à envoyer.
 *
 *  Ici, l'alerte est simplement DÉPOSÉE en brouillon. Deux lectures Supabase,
 *  aucun appel sortant, aucune erreur possible à afficher. Le tableau de bord
 *  la montrera, quelqu'un la lira, et c'est lui qui décidera de l'envoi
 *  (POST /api/whatsapp/outbox/drafts).
 *
 *  Conséquence voulue : plus rien ne part vers une famille sans qu'un humain
 *  de l'école ait lu le texte exact qui va lui être écrit. */

interface Recipient {
  phone?: unknown;
  name?: unknown;
  studentId?: unknown;
  parentId?: unknown;
  message?: { text?: unknown };
  text?: unknown;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export async function POST(request: Request) {
  try {
    await assertCanSendWhatsApp();

    const body = (await request.json()) as { recipients?: unknown };
    const recipients = Array.isArray(body.recipients) ? (body.recipients as Recipient[]) : [];
    if (recipients.length === 0) {
      return NextResponse.json({ error: "Aucun destinataire." }, { status: 400 });
    }

    const entries: QueueEntry[] = [];
    let invalid = 0;

    for (const r of recipients) {
      const text = str(r.message?.text) ?? str(r.text);
      const phone = str(r.phone);
      const normalized = phone ? normalizePhone(phone) : null;

      // Un numéro invalide ou un texte vide ne deviendra jamais valide en
      // attendant : on l'écarte tout de suite plutôt que d'encombrer la file.
      if (!normalized || !text || text.length > MAX_MESSAGE_LENGTH) {
        invalid++;
        continue;
      }

      entries.push({
        recipientPhone: normalized.msisdn,
        recipientDisplay: normalized.display,
        recipientName: str(r.name),
        studentId: str(r.studentId),
        parentId: str(r.parentId),
        messageType: "text",
        body: text,
      });
    }

    // Un élève qui badge trois cours dans la journée ne doit pas remplir le
    // tableau de bord de trois fois la même phrase.
    const fresh = await withoutQueuedDuplicates(entries);
    const queued = await queueMessages(fresh, { status: "draft" });

    return NextResponse.json({
      queued,
      duplicates: entries.length - fresh.length,
      invalid,
    });
  } catch (err) {
    if (err instanceof WhatsAppError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inattendue." },
      { status: 500 },
    );
  }
}
