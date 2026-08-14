import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import {
  WhatsAppError,
  getConfig,
  getConfiguredTemplates,
  getPhoneNumberInfo,
  hasWebhookVerifyToken,
  maskId,
} from "@/lib/whatsapp/client";
import type { WhatsAppConfigState } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

/** État de la configuration WhatsApp Cloud (Meta) pour l'écran Paramètres →
 *  WhatsApp. Réservé à l'administration/réception. Ne renvoie AUCUN secret :
 *  ni jeton d'accès, ni App Secret, ni jeton de vérification du webhook — seuls
 *  des identifiants masqués et un statut de connexion. */
export async function GET() {
  try {
    await assertCanSendWhatsApp();

    const config = getConfig();
    if (!config) {
      return NextResponse.json<WhatsAppConfigState>({
        configured: false,
        connected: false,
        phoneNumber: null,
        verifiedName: null,
        phoneNumberIdMasked: null,
        businessAccountIdMasked: null,
        apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || "",
        webhookConfigured: hasWebhookVerifyToken(),
        configuredTemplates: [],
        error: null,
      });
    }

    // Appel réel à Graph : confirme que le jeton et le numéro sont valides.
    let connected = false;
    let phoneNumber: string | null = null;
    let verifiedName: string | null = null;
    let error: string | null = null;
    try {
      const info = await getPhoneNumberInfo();
      connected = true;
      phoneNumber = info.displayPhoneNumber;
      verifiedName = info.verifiedName;
    } catch (err) {
      error = err instanceof WhatsAppError ? err.message : "Vérification de la connexion impossible.";
    }

    return NextResponse.json<WhatsAppConfigState>({
      configured: true,
      connected,
      phoneNumber,
      verifiedName,
      phoneNumberIdMasked: maskId(config.phoneNumberId),
      businessAccountIdMasked: maskId(config.businessAccountId),
      apiVersion: config.apiVersion,
      webhookConfigured: hasWebhookVerifyToken(),
      configuredTemplates: getConfiguredTemplates(),
      error,
    });
  } catch (err) {
    if (err instanceof WhatsAppError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Impossible de lire l'état de la configuration WhatsApp." }, { status: 500 });
  }
}
