"use client";

import { Lock } from "lucide-react";
import { Card } from "@/components/ui/Card";

/**
 * « Cet écran est réservé à la direction ».
 *
 * Retirer une entrée du menu ne ferme pas la porte : l'URL reste tapable, un
 * signet la garde, et un lien envoyé par message la rouvre. Un écran d'argent
 * qui n'est pas pour le guichet doit donc le DIRE, plutôt que de s'afficher
 * quand on l'appelle par son chemin.
 *
 * Ce n'est pas une barrière de sécurité — celles-là vivent dans les règles RLS
 * de la base, qui refusent la lecture des tables concernées. C'est la réponse
 * lisible qui va avec.
 */
export function RestrictedPage({
  title = "Écran réservé à la direction",
  message = "Votre compte n'a pas accès à cet écran. Adressez-vous à la direction si vous pensez en avoir besoin.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="mx-auto max-w-lg py-16">
      <Card className="border border-line bg-canvas/40 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-warning/30 bg-warning/10">
          <Lock className="h-5 w-5 text-warning" />
        </div>
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">{message}</p>
      </Card>
    </div>
  );
}
