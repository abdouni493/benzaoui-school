"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/store/data";
import { useSession } from "@/lib/store/session";
import { uploadImage } from "@/lib/supabase/uploadImage";
import { changeOwnPassword } from "@/lib/supabase/createUser";
import { createClient } from "@/lib/supabase/client";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Settings,
  Shield,
  Download,
  Upload,
  AlertTriangle,
  School as SchoolIcon,
  Phone,
  Mail,
  MapPin,
  FileText,
  Lock,
  User,
  DollarSign,
  Save,
  Globe,
  Image,
  Coins
} from "lucide-react";

export function SettingsPage() {
  const dataStore = useData();
  const { school, updateSchool, restoreState } = dataStore;
  const sessionUser = useSession((s) => s.user);
  const loginSession = useSession((s) => s.login);
  const [logoUploading, setLogoUploading] = useState(false);

  // Tabs navigation state
  const [activeTab, setActiveTab] = useState<"school" | "security" | "backup">("school");

  // School Form State
  const [schoolName, setSchoolName] = useState(school?.name || "");
  const [schoolDesc, setSchoolDesc] = useState(school?.description || "");
  const [schoolLogo, setSchoolLogo] = useState(school?.logo || "");
  const [schoolPhone, setSchoolPhone] = useState(school?.phone || "");
  const [schoolEmail, setSchoolEmail] = useState(school?.email || "");
  const [schoolAddress, setSchoolAddress] = useState(school?.address || "");
  const [articleFiscal, setArticleFiscal] = useState(school?.articleFiscal || "");
  const [registreCommerce, setRegistreCommerce] = useState(school?.registreCommerce || "");
  const [nif, setNif] = useState(school?.nif || "");
  const [nis, setNis] = useState(school?.nis || "");
  const [registrationFee, setRegistrationFee] = useState<number>(school?.registrationFee || 0);
  const [absencePenaltyEnabled, setAbsencePenaltyEnabled] = useState<boolean>(school?.absencePenaltyEnabled ?? true);
  const [absencePenaltySince, setAbsencePenaltySince] = useState<string>(school?.absencePenaltySince || "");

  // `school` loads asynchronously (fetched from Supabase after mount), so
  // the useState initializers above only capture whatever was there at the
  // first render — usually still empty. Re-sync once the real row arrives.
  useEffect(() => {
    if (!school?.id) return;
    setSchoolName(school.name || "");
    setSchoolDesc(school.description || "");
    setSchoolLogo(school.logo || "");
    setSchoolPhone(school.phone || "");
    setSchoolEmail(school.email || "");
    setSchoolAddress(school.address || "");
    setArticleFiscal(school.articleFiscal || "");
    setRegistreCommerce(school.registreCommerce || "");
    setNif(school.nif || "");
    setNis(school.nis || "");
    setRegistrationFee(school.registrationFee || 0);
    setAbsencePenaltyEnabled(school.absencePenaltyEnabled ?? true);
    setAbsencePenaltySince(school.absencePenaltySince || "");
  }, [school?.id]);

  // Saved on its own (not folded into handleSaveSchool) so that, on a project
  // where the weekly-absence migration hasn't been applied yet, an unknown
  // column error here can't block the rest of the school form from saving.
  const handleSaveAbsenceBilling = () => {
    updateSchool({
      absencePenaltyEnabled,
      absencePenaltySince: absencePenaltySince || undefined,
    });
  };

  // Admin Account Form State (name + password; email change requires
  // re-confirmation via Supabase Auth so it's shown read-only here)
  const [adminName, setAdminName] = useState(sessionUser?.name || "");
  const [adminPassword, setAdminPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingAdmin, setSavingAdmin] = useState(false);

  useEffect(() => {
    if (sessionUser?.name) setAdminName(sessionUser.name);
  }, [sessionUser?.name]);

  // Backup/Restore State
  const [restoreJsonText, setRestoreJsonText] = useState("");
  const [restoreError, setRestoreError] = useState("");

  const handleSaveSchool = () => {
    if (!schoolName.trim()) {
      alert("Le nom de l'établissement est requis.");
      return;
    }
    updateSchool({
      name: schoolName,
      description: schoolDesc,
      logo: schoolLogo,
      phone: schoolPhone,
      email: schoolEmail,
      address: schoolAddress,
      articleFiscal,
      registreCommerce,
      nif,
      nis,
      registrationFee: Number(registrationFee) || 0,
    });
  };

  const handleSaveAdmin = async () => {
    if (!sessionUser) return;
    if (!adminName.trim()) {
      alert("Le nom est requis.");
      return;
    }
    if (adminPassword && adminPassword.length < 6) {
      alert("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    setSavingAdmin(true);
    try {
      if (adminName.trim() !== sessionUser.name) {
        const supabase = createClient();
        const { error } = await supabase
          .from("profiles")
          .update({ full_name: adminName.trim() })
          .eq("id", sessionUser.id);
        if (error) throw new Error(error.message);
        loginSession({ ...sessionUser, name: adminName.trim() });
      }
      if (adminPassword) {
        await changeOwnPassword(adminPassword);
        setAdminPassword("");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la mise à jour.");
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleDownloadBackup = () => {
    const backupData: Record<string, any> = {};
    Object.keys(dataStore).forEach((key) => {
      const val = (dataStore as any)[key];
      if (typeof val !== "function") {
        backupData[key] = val;
      }
    });

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `backup-elilm-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRestoreBackup = () => {
    try {
      setRestoreError("");
      if (!restoreJsonText.trim()) {
        setRestoreError("Veuillez coller le contenu JSON de sauvegarde.");
        return;
      }
      const parsed = JSON.parse(restoreJsonText);
      if (!parsed.school || !parsed.students) {
        setRestoreError("Format JSON invalide. Les tables clés de la structure de base sont manquantes.");
        return;
      }

      restoreState(parsed);
      setRestoreJsonText("");
    } catch (e: any) {
      setRestoreError(`Erreur lors de l'analyse du JSON : ${e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader emoji="⚙️" title="Paramètres" subtitle="Configuration générale, sécurité et maintenance du système" />

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Settings Navigation Sidebar */}
        <div className="w-full md:w-64 flex flex-col gap-1.5 shrink-0 bg-surface border border-line p-3 rounded-2xl card-shadow">
          <span className="text-[10px] text-muted font-bold uppercase tracking-wider px-3 mb-2 block">
            Catégories
          </span>
          
          <button
            onClick={() => setActiveTab("school")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
              activeTab === "school"
                ? "bg-primary-50 text-primary border border-primary/20 shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50 border border-transparent"
            }`}
          >
            <SchoolIcon className="h-4.5 w-4.5" />
            <span>Établissement</span>
          </button>

          <button
            onClick={() => setActiveTab("security")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
              activeTab === "security"
                ? "bg-primary-50 text-primary border border-primary/20 shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50 border border-transparent"
            }`}
          >
            <Shield className="h-4.5 w-4.5" />
            <span>Identifiants & Sécurité</span>
          </button>

          <button
            onClick={() => setActiveTab("backup")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
              activeTab === "backup"
                ? "bg-primary-50 text-primary border border-primary/20 shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50 border border-transparent"
            }`}
          >
            <Download className="h-4.5 w-4.5" />
            <span>Sauvegarde & Données</span>
          </button>
        </div>

        {/* Settings Active View */}
        <div className="flex-1 w-full">
          {/* TAB 1: School Profile */}
          {activeTab === "school" && (
            <Card className="border border-line rounded-2xl card-shadow">
              <CardBody className="space-y-6 p-6">
                <div>
                  <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                    <SchoolIcon className="h-5 w-5 text-primary" /> Profil de l'Établissement
                  </h3>
                  <p className="text-xs text-muted mt-1">Gérer les détails descriptifs et l'identité visuelle de votre école.</p>
                </div>

                {/* Section 1: General Info */}
                <div className="bg-canvas/20 border border-line/60 rounded-2xl p-4 space-y-4">
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block border-b border-line pb-1.5">
                    Informations Générales
                  </span>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        Nom de l'école *
                      </label>
                      <Input
                        value={schoolName}
                        onChange={(e) => setSchoolName(e.target.value)}
                        placeholder="Ex: École Privée El Ilm"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">
                        Slogan / Description
                      </label>
                      <Input
                        value={schoolDesc}
                        onChange={(e) => setSchoolDesc(e.target.value)}
                        placeholder="Ex: Cours de soutien & formations"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <Coins className="h-3.5 w-3.5 text-muted" /> Frais d'inscription par défaut (DA)
                      </label>
                      <Input
                        type="number"
                        value={registrationFee || ""}
                        onChange={(e) => setRegistrationFee(Number(e.target.value))}
                        placeholder="Ex: 1000"
                        className="rounded-xl"
                      />
                    </div>

                    <div className="sm:col-span-2 border border-line/60 bg-canvas/10 p-4 rounded-2xl space-y-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                        <div>
                          <label className="block text-xs font-bold text-ink">Facturation automatique des absences</label>
                          <p className="text-[10px] text-muted mt-0.5 leading-relaxed">
                            Pour chaque module, si l&apos;élève n&apos;a ni scanné sa carte ni été marqué présent
                            pendant 7 jours, le prix de la séance de ce module est débité de son solde
                            (la dette est autorisée). Le décompte repart à chaque présence.
                          </p>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={absencePenaltyEnabled}
                          onChange={(e) => setAbsencePenaltyEnabled(e.target.checked)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="text-xs font-semibold text-ink">
                          {absencePenaltyEnabled ? "Activée" : "Désactivée"}
                        </span>
                      </label>
                      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                        <div className="flex-1">
                          <label className="block text-[10px] font-semibold text-muted mb-1">
                            Facturer les semaines à partir du (les absences avant cette date ne sont jamais facturées)
                          </label>
                          <Input
                            type="date"
                            value={absencePenaltySince}
                            onChange={(e) => setAbsencePenaltySince(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                        <Button variant="outline" onClick={handleSaveAbsenceBilling} className="shrink-0">
                          <Save className="h-3.5 w-3.5 me-1.5" /> Enregistrer
                        </Button>
                      </div>
                    </div>

                    <div className="sm:col-span-2 border-t border-line/50 pt-4 mt-2 flex flex-col sm:flex-row items-center gap-4 bg-canvas/10 p-4 rounded-2xl">
                      <div className="h-16 w-16 rounded-2xl bg-canvas border border-line flex items-center justify-center overflow-hidden shrink-0 relative">
                        {schoolLogo ? (
                          <img src={schoolLogo} alt="Logo" className="h-full w-full object-cover" />
                        ) : (
                          <SchoolIcon className="h-8 w-8 text-muted" />
                        )}
                      </div>

                      <div className="flex-1 text-center sm:text-left space-y-1.5">
                        <label className="block text-xs font-bold text-ink">Logo de l'Établissement</label>
                        <p className="text-[10px] text-muted">Format recommandé : Image carrée (PNG, JPG), max 10 Mo.</p>

                        <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                          <label className="cursor-pointer bg-primary hover:bg-primary/90 text-white rounded-xl px-3 py-1.5 text-[11px] font-bold transition-all shadow-sm flex items-center gap-1.5">
                            <Upload className="h-3.5 w-3.5" />
                            <span>{logoUploading ? "Envoi..." : "Importer une image"}</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={logoUploading}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setLogoUploading(true);
                                try {
                                  const url = await uploadImage("logos", file);
                                  setSchoolLogo(url);
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : "Échec de l'envoi de l'image.");
                                } finally {
                                  setLogoUploading(false);
                                }
                              }}
                            />
                          </label>

                          {schoolLogo && (
                            <button
                              type="button"
                              onClick={() => setSchoolLogo("")}
                              className="bg-danger/10 hover:bg-danger/15 text-danger border border-danger/30 rounded-xl px-3 py-1.5 text-[11px] font-bold transition-all flex items-center gap-1.5"
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 2: Contact Details */}
                <div className="bg-canvas/20 border border-line/60 rounded-2xl p-4 space-y-4">
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block border-b border-line pb-1.5">
                    Coordonnées de Contact
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-muted" /> Numéro de téléphone
                      </label>
                      <Input
                        value={schoolPhone}
                        onChange={(e) => setSchoolPhone(e.target.value)}
                        placeholder="+213 XX XX XX XX"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-muted" /> Adresse Email
                      </label>
                      <Input
                        type="email"
                        value={schoolEmail}
                        onChange={(e) => setSchoolEmail(e.target.value)}
                        placeholder="contact@ecole.com"
                        className="rounded-xl"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted" /> Adresse Physique
                      </label>
                      <Input
                        value={schoolAddress}
                        onChange={(e) => setSchoolAddress(e.target.value)}
                        placeholder="Alger, Algérie"
                        className="rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 3: Legal & Fiscal info */}
                <div className="bg-canvas/20 border border-line/60 rounded-2xl p-4 space-y-4">
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block border-b border-line pb-1.5">
                    Données Fiscales & Légales
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-muted" /> Article Fiscal
                      </label>
                      <Input
                        value={articleFiscal}
                        onChange={(e) => setArticleFiscal(e.target.value)}
                        placeholder="Ex: ART-2024-0091"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 text-muted" /> Registre de Commerce (RC)
                      </label>
                      <Input
                        value={registreCommerce}
                        onChange={(e) => setRegistreCommerce(e.target.value)}
                        placeholder="Ex: RC-16-554120"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">N.I.F.</label>
                      <Input
                        value={nif}
                        onChange={(e) => setNif(e.target.value)}
                        placeholder="Identifiant Fiscal"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">N.I.S.</label>
                      <Input
                        value={nis}
                        onChange={(e) => setNis(e.target.value)}
                        placeholder="Identifiant Statistique"
                        className="rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-line flex justify-end">
                  <Button
                    onClick={handleSaveSchool}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold"
                  >
                    <Save className="h-4 w-4" /> Enregistrer les informations
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* TAB 2: Credentials & Security */}
          {activeTab === "security" && (
            <Card className="border border-line rounded-2xl card-shadow">
              <CardBody className="space-y-6 p-6">
                <div>
                  <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" /> Sécurité & Identifiants Admin
                  </h3>
                  <p className="text-xs text-muted mt-1">Modifier les accès au panneau d'administration général.</p>
                </div>

                {sessionUser ? (
                  <div className="space-y-5 text-xs">
                    <div className="bg-canvas/20 border border-line/60 rounded-2xl p-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-muted" /> Nom complet
                          </label>
                          <Input
                            value={adminName}
                            onChange={(e) => setAdminName(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5 text-muted" /> Adresse Email (connexion)
                          </label>
                          <Input type="email" value={sessionUser.email} disabled className="rounded-xl opacity-60" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                            <Lock className="h-3.5 w-3.5 text-muted" /> Nouveau mot de passe
                          </label>
                          <div className="relative">
                            <Input
                              type={showPassword ? "text" : "password"}
                              value={adminPassword}
                              onChange={(e) => setAdminPassword(e.target.value)}
                              placeholder="Laisser vide pour ne pas changer"
                              className="rounded-xl w-full pr-12"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted hover:text-ink text-[11px] font-bold"
                            >
                              {showPassword ? "Masquer" : "Afficher"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-line flex justify-end">
                      <Button
                        onClick={handleSaveAdmin}
                        disabled={savingAdmin}
                        className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold"
                      >
                        <Save className="h-4 w-4" /> {savingAdmin ? "..." : "Mettre à jour la sécurité"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 bg-warning/10 border border-warning/20 rounded-2xl flex items-center gap-2 text-warning">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <span className="text-xs font-semibold">Compte administrateur introuvable.</span>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* TAB 3: Backup & Restore */}
          {activeTab === "backup" && (
            <div className="space-y-6">
              {/* Export panel */}
              <Card className="border border-line rounded-2xl card-shadow">
                <CardBody className="space-y-4 p-6">
                  <div>
                    <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                      <Download className="h-5 w-5 text-success" /> Sauvegarde locale de sécurité
                    </h3>
                    <p className="text-xs text-muted mt-1">Conservez une copie locale physique de toutes vos données.</p>
                  </div>

                  <p className="text-xs text-muted/80 leading-relaxed">
                    Téléchargez une copie complète au format <strong>JSON</strong> contenant toutes les informations enregistrées :
                    élèves, abonnements, présences, acomptes, journal de caisse et dépenses de fonctionnement.
                  </p>

                  <div className="pt-2">
                    <Button
                      onClick={handleDownloadBackup}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 bg-success hover:bg-success/90 border-none px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-md"
                    >
                      <Download className="h-4.5 w-4.5" /> Exporter la base de données (.json)
                    </Button>
                  </div>
                </CardBody>
              </Card>

              {/* Import panel */}
              <Card className="border border-line rounded-2xl card-shadow">
                <CardBody className="space-y-4 p-6">
                  <div>
                    <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                      <Upload className="h-5 w-5 text-warning" /> Restaurer une sauvegarde existante
                    </h3>
                    <p className="text-xs text-muted mt-1">Réinstaller un état précédent à partir de votre JSON exporté.</p>
                  </div>

                  <div className="p-4 bg-danger/10 border border-danger/25 rounded-2xl text-danger flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-xs block font-bold">Action Critique !</strong>
                      <span className="text-[11px] block mt-0.5 leading-relaxed">
                        L'importation écrase l'intégralité des données en mémoire courante de l'application. Assurez-vous
                        de posséder une sauvegarde récente avant de procéder.
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-muted">Contenu JSON de sauvegarde</label>
                    <textarea
                      value={restoreJsonText}
                      onChange={(e) => setRestoreJsonText(e.target.value)}
                      placeholder='Coller le JSON ici... {"school": {...}, "students": [...]}'
                      rows={6}
                      className="w-full rounded-2xl border border-line bg-canvas p-4 font-mono text-[10px] text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                    />

                    {restoreError && (
                      <div className="p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger flex items-center gap-2 text-xs">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>{restoreError}</span>
                      </div>
                    )}

                    <div className="pt-2 flex justify-end">
                      <Button
                        onClick={handleRestoreBackup}
                        variant="outline"
                        className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-bold border-line hover:bg-primary-50 text-ink"
                      >
                        Lancer la Restauration
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
