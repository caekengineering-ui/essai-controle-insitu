'use strict';
/* ============================================================
   Bilingue FR / AR (parcours opérateur).
   - Clé = texte français affiché ; valeur = traduction arabe.
   - Traduit le HTML statique ET le contenu généré (MutationObserver).
   - Les JETONS TECHNIQUES ne sont jamais traduits (EV1, MPa, γd, NF P94-…,
     QC/P60, PIN, GPS, OPM, %, Ø600…) : ils ne figurent tout simplement pas
     dans le dictionnaire, et sont isolés en LTR par le CSS.
   - Le PV PDF reste en français (document officiel).
   ============================================================ */
const I18N = (() => {
  const KEY = 'caek-lang';
  let _lang = localStorage.getItem(KEY) || 'fr';
  let _obs = null;

  const AR = {
    // ---- Connexion ----
    "Essai de contrôle in situ — Connexion opérateur": "اختبار المراقبة في الموقع — دخول المُشغّل",
    "Identifiant": "المعرّف",
    "Code PIN": "الرمز السري (PIN)",
    "Se connecter": "تسجيل الدخول",
    "Connexion…": "جارٍ الدخول…",
    "Identifiants fournis par l'administrateur du laboratoire.": "المعرّفات يقدّمها مسؤول المخبر.",
    "Saisissez l'identifiant et le code PIN.": "أدخل المعرّف والرمز السري (PIN).",
    "Code PIN incorrect.": "الرمز السري (PIN) غير صحيح.",
    "Compte désactivé. Contactez l'administrateur.": "الحساب موقوف. اتصل بالمسؤول.",
    "Identifiant inconnu.": "المعرّف غير معروف.",
    "Pas de connexion au serveur. Vérifiez le réseau.": "لا يوجد اتصال بالخادم. تحقّق من الشبكة.",
    "Se déconnecter ?": "تسجيل الخروج؟",

    // ---- En-tête / accueil ----
    "Essai de contrôle in situ": "اختبار المراقبة في الموقع",
    "Choisissez le type d'essai à réaliser": "اختر نوع الاختبار المطلوب",
    "Essai à la plaque": "اختبار التحميل بالصفيحة",
    "Essai de compacité": "اختبار درجة الدمك",
    "EV2 Ø600 · NF P94-117-1": "EV2 Ø600 · NF P94-117-1",
    "Taux de compactage · NF P94-061": "نسبة الدمك · NF P94-061",
    "Répertoire des fiches": "سجلّ الاختبارات",
    "Répertoire": "السجلّ",
    "Administration (opérateurs, entreprises, projets)": "الإدارة (المشغّلون، المؤسسات، المشاريع)",

    // ---- Profil ----
    "Profil opérateur": "ملف المُشغّل",
    "Nom": "الاسم",
    "Fonction": "الوظيفة",
    "Rôle": "الصلاحية",
    "Administrateur": "مسؤول",
    "Opérateur": "مُشغّل",
    "Changer mon code PIN": "تغيير الرمز السري (PIN)",
    "Ancien PIN": "الرمز القديم",
    "Nouveau PIN": "الرمز الجديد",
    "Modifier le PIN": "تعديل الرمز",
    "PIN modifié.": "تمّ تعديل الرمز.",
    "Ancien PIN incorrect.": "الرمز القديم غير صحيح.",

    // ---- Boutons / navigation communs ----
    "← Retour": "رجوع ↩",
    "← Accueil": "الرئيسية ↩",
    "← Répertoire": "السجلّ ↩",
    "Suivant →": "التالي →",
    "← Précédent": "→ السابق",
    "Annuler": "إلغاء",
    "Enregistrer": "حفظ",
    "Actualiser": "تحديث",
    "🔄 Actualiser": "🔄 تحديث",

    // ---- Étapes assistant ----
    "Projet": "المشروع",
    "Ouvrage": "المنشأ",
    "Méthodo": "المنهجية",
    "Sécurité": "السلامة",
    "Proctor": "بروكتور",
    "Par client": "حسب الزبون",
    "Par code projet": "حسب رمز المشروع",
    "Client *": "الزبون *",
    "Client": "الزبون",
    "Projet *": "المشروع *",
    "— Choisir un client —": "— اختر الزبون —",
    "— Choisir un projet —": "— اختر المشروع —",
    "Code projet *": "رمز المشروع *",
    "Mode": "الوضع",
    "Auto-contrôle": "مراقبة ذاتية",
    "Contrôle": "مراقبة",
    "Projet inconnu ou inactif. Ajoutez/activez-le dans Admin → Projets.": "مشروع غير معروف أو غير مُفعّل. أضِفه/فعّله في الإدارة ← المشاريع.",
    "Saisir la référence manuellement": "إدخال المرجع يدويًا",
    "Référence": "المرجع",

    // ---- Ouvrage ----
    "Ouvrage *": "المنشأ *",
    "Ajouter une partie d'ouvrage": "إضافة جزء من المنشأ",
    "Partie d'ouvrage": "جزء المنشأ",
    "Niveau": "المنسوب",
    "Nature du matériau": "طبيعة المادة",
    "Nombre d'essais *": "عدد الاختبارات *",
    "Nombre d'essais (saisie)": "عدد الاختبارات (إدخال)",
    "Indiquez l'ouvrage testé.": "حدّد المنشأ المختبَر.",

    // ---- CPS ----
    "EV1 minimum (MPa)": "EV1 الأدنى (MPa)",
    "EV2 minimum (MPa)": "EV2 الأدنى (MPa)",
    "K maximum": "K الأقصى",
    "Taux de compactage minimal (%)": "نسبة الدمك الدنيا (%)",

    // ---- Méthodologie / Proctor ----
    "Méthodologie": "المنهجية",
    "Type de réaction": "نوع رد الفعل (السند)",
    "Méthode de mesure (choisit la norme)": "طريقة القياس (تحدّد المعيار)",
    "— Choisir la méthode —": "— اختر الطريقة —",
    "Choisissez la méthode de mesure (elle détermine la norme).": "اختر طريقة القياس (تحدّد المعيار).",
    "Référence Proctor (OPM) — obligatoire": "مرجع بروكتور (OPM) — إلزامي",
    "Densité sèche max OPM": "الكثافة الجافة القصوى OPM",
    "Unité de densité": "وحدة الكثافة",
    "Teneur en eau OPM (%)": "نسبة الرطوبة OPM (%)",
    "Densité sèche max OPM obligatoire.": "الكثافة الجافة القصوى OPM إلزامية.",

    // ---- Sécurité ----
    "Cochez tous les points de sécurité avant de commencer.": "أكّد جميع نقاط السلامة قبل البدء.",
    "Cochez tous les points avant de commencer.": "أكّد جميع النقاط قبل البدء.",
    "COMMENCER LE TEST": "ابدأ الاختبار",
    "COMMENCER LES MESURES": "ابدأ القياسات",
    "Veuillez valider tous les points de sécurité avant de continuer.": "يرجى تأكيد جميع نقاط السلامة قبل المتابعة.",
    "Veuillez valider tous les points avant de continuer.": "يرجى تأكيد جميع النقاط قبل المتابعة.",

    // ---- Écran essai ----
    "Suspendre": "إيقاف مؤقت",
    "Repérage du point": "تحديد النقطة",
    "Point / Repère": "النقطة / العلامة",
    "N° d'essai": "رقم الاختبار",
    "Emplacement / Coordonnées": "الموقع / الإحداثيات",
    "Date": "التاريخ",
    "Heure": "الساعة",
    "Coordonnées GPS (Latitude, Longitude)": "إحداثيات GPS (خط العرض، خط الطول)",
    "Obtenir ma position": "تحديد موقعي",
    "Météo": "الطقس",
    "— Météo —": "— الطقس —",
    "Soleil": "مشمس", "Nuageux": "غائم", "Pluie": "ممطر", "Brumeux": "ضبابي", "Venteux": "عاصف",
    "Mesures": "القياسات",
    "Remise à zéro (RAZ) après 1ᵉʳ cycle ?": "إعادة التصفير (RAZ) بعد الدورة الأولى؟",
    "Oui": "نعم", "Non": "لا",
    "Mode de saisie de la densité sèche": "طريقة إدخال الكثافة الجافة",
    "Humide + eau": "رطبة + ماء",
    "Sèche directe": "جافة مباشرة",
    "Densité humide in situ": "الكثافة الرطبة في الموقع",
    "Teneur en eau in situ (%)": "نسبة الرطوبة في الموقع (%)",
    "Densité sèche in situ": "الكثافة الجافة في الموقع",
    "Observations": "ملاحظات",
    "AFFICHER LES RÉSULTATS": "عرض النتائج",
    "Résultats": "النتائج",
    "ENREGISTRER & ESSAI SUIVANT": "حفظ والاختبار التالي",
    "Affichez d'abord les résultats.": "اعرض النتائج أولًا.",
    "Aucune exigence CPS renseignée": "لا توجد متطلبات CPS",
    "CONFORME": "مطابق", "NON CONFORME": "غير مطابق",

    // ---- Répertoire ----
    "Toutes": "الكل", "Incomplètes": "غير مكتملة", "Brouillons": "مسودّات", "Validées": "معتمَدة",
    "Tous types": "كل الأنواع",
    "Aucune fiche dans cette catégorie.": "لا توجد بطاقة في هذه الفئة.",
    "👁 Consulter": "👁 عرض",
    "✅ Valider": "✅ اعتماد",
    "📤 Envoyer": "📤 إرسال",
    "🗑️ Supprimer": "🗑️ حذف",
    "Incomplet": "غير مكتمل", "Brouillon achevé": "مسودّة منتهية", "Validé": "معتمَد",

    // ---- Détail / validation ----
    "Identification": "التعريف",
    "Type": "النوع",
    "Compacité in situ": "درجة الدمك في الموقع",
    "Code projet": "رمز المشروع",
    "Lieu": "المكان",
    "Type de réaction": "نوع السند",
    "Exigences CPS": "متطلبات CPS",
    "Méthode": "الطريقة",
    "Norme": "المعيار",
    "Matériau": "المادة",
    "Envoyer au bureau": "إرسال إلى المكتب",
    "Valider définitivement": "اعتماد نهائي",
    "Créer une version corrigée": "إنشاء نسخة مصحّحة",
    "Validée le": "اعتُمدت في",
    "Validée par": "اعتمدها",
    "Version": "الإصدار",
    "Aucun essai enregistré.": "لا يوجد اختبار مسجّل.",
    "Aucune mesure enregistrée.": "لا يوجد قياس مسجّل.",

    // ---- Divers messages ----
    "Suspendre la campagne ? Les essais saisis sont enregistrés.": "إيقاف الحملة مؤقتًا؟ الاختبارات المُدخلة محفوظة.",
    "Suspendre la campagne ? Les mesures saisies sont enregistrées.": "إيقاف الحملة مؤقتًا؟ القياسات المُدخلة محفوظة.",
    "Session expirée ou compte désactivé. Veuillez vous reconnecter.": "انتهت الجلسة أو أُوقف الحساب. يرجى إعادة الدخول.",

    // ---- Compléments parcours opérateur ----
    "Administration": "الإدارة",
    "(opérateurs, entreprises, projets)": "(المشغّلون، المؤسسات، المشاريع)",
    "(essai antérieur / numéro précis)": "(اختبار سابق / رقم محدّد)",
    "Nouvel essai": "اختبار جديد",
    "Camion": "شاحنة", "Engin": "آلة", "Autre": "أخرى",
    "Lectures comparateurs (1/1000 mm)": "قراءات المقياس (1/1000 mm)",
    "e1 — 1ᵉʳ cycle": "e1 — الدورة الأولى",
    "z2 — 2ᵉ cycle": "z2 — الدورة الثانية",
    "z0 — avant 2ᵉ cycle": "z0 — قبل الدورة الثانية",
    "z1 — après 2ᵉ cycle": "z1 — بعد الدورة الثانية",
    "Chef de projet": "مسؤول المشروع",
    "Chargé d'essai": "المكلّف بالاختبار",
    "Conclusion :": "الخلاصة :",
    "CONFORME aux exigences CPS": "مطابق لمتطلبات CPS",
    "NON CONFORME aux exigences CPS": "غير مطابق لمتطلبات CPS",
    "Aucune exigence CPS renseignée — résultats fournis à titre informatif.": "لا توجد متطلبات CPS — النتائج للعلم فقط.",
    "Copier le texte": "نسخ النص",
    "Fermer": "إغلاق",
    "Modifier": "تعديل",
    "Reprendre": "استئناف",
    "Consulter": "عرض",
    "Envoyer": "إرسال",
    "Supprimer": "حذف",

    // ---- Explications techniques (aide inline, toujours visible) ----
    "Lecture finale du 1ᵉʳ chargement à 2,5 bar": "القراءة النهائية للتحميل الأول عند 2,5 bar",
    "Lecture du 2ᵉ chargement à 2,0 bar (comparateurs remis à zéro)": "قراءة التحميل الثاني عند 2,0 bar (بعد إعادة تصفير المقاييس)",
    "Lecture résiduelle après déchargement, avant le 2ᵉ chargement": "القراءة المتبقّية بعد التفريغ، قبل التحميل الثاني",
    "Lecture totale finale du 2ᵉ chargement à 2,0 bar — z2 = z1 − z0": "القراءة الكلّية النهائية للتحميل الثاني عند 2,0 bar — z2 = z1 − z0",
    "Comparateurs remis à zéro après le 1ᵉʳ cycle : saisir e1 et z2.": "المقاييس مُصفّرة بعد الدورة الأولى: أدخل e1 و z2.",
    "Sans remise à zéro : saisir e1, z0 et z1. z2 = z1 − z0.": "بدون إعادة تصفير: أدخل e1 و z0 و z1. z2 = z1 − z0.",
    // ---- Consignes de sécurité — PLAQUE ----
    "Surface de contact préparée": "سطح التماس مُهيّأ",
    "Plaque Ø600 mm correctement mise en place": "الصفيحة Ø600 mm موضوعة بشكل صحيح",
    "Camion / engin de réaction correctement positionné": "الشاحنة / الآلة (السند) في وضع صحيح",
    "Massif de réaction suffisant > 8000 daN": "كتلة السند كافية > 8000 daN",
    "Flexible hydraulique vérifié": "الخرطوم الهيدروليكي مُتحقَّق منه",
    "Vérin et pompe vérifiés": "الرافعة والمضخّة مُتحقَّق منهما",
    "Comparateurs vérifiés": "المقاييس (المؤشّرات) مُتحقَّق منها",
    "Poutre Benkelman stable": "عارضة Benkelman مستقرّة",
    "Charge de mise en place 500 daN ± 50 daN (10 à 15 s)": "حمل التهيئة 500 daN ± 50 daN (10 إلى 15 ثانية)",
    "Déchargement initial effectué": "تمّ التفريغ الأولي",
    "Zone sécurisée autour du système de chargement": "المنطقة مؤمّنة حول نظام التحميل",
    // ---- Consignes de sécurité — COMPACITÉ ----
    "Surface d'essai dégagée et représentative": "سطح الاختبار نظيف وممثِّل",
    "Appareil de mesure étalonné / vérifié": "جهاز القياس مُعاير / مُتحقَّق منه",
    "Référence Proctor (OPM) disponible et correcte": "مرجع بروكتور (OPM) متوفّر وصحيح",
    "Profondeur / couche testée conforme": "العمق / الطبقة المختبَرة مطابقة",
    "Zone de mesure sécurisée": "منطقة القياس مؤمّنة",

    "γd = γh / (1 + w/100)": "γd = γh / (1 + w/100)",
    "Saisir directement la densité sèche in situ.": "أدخل الكثافة الجافة في الموقع مباشرة.",
    "Une ligne par point. Emplacement = repère ou coordonnées GPS.": "سطر لكل نقطة. الموقع = علامة أو إحداثيات GPS.",
    "Fonctionne sur téléphone en HTTPS. Champs toujours modifiables à la main.": "يعمل على الهاتف عبر HTTPS. الحقول قابلة للتعديل يدويًا دائمًا.",
    "Emplacement (repère) ou coordonnées GPS.": "الموقع (علامة) أو إحداثيات GPS.",
    "Le code de mesure choisit la norme": "طريقة القياس تحدّد المعيار",

    // ---- Module ARRACHEMENT — accueil et assistant ----
    "Essai d'arrachement": "اختبار النزع",
    "Essai d'arrachement sur clous": "اختبار النزع على المسامير التثبيتية",
    "Clous d'ancrage · NF P94-242-1": "مسامير التثبيت · NF P94-242-1",
    "Essai": "الاختبار",
    "Matériel": "العتاد",
    "Paliers": "المراحل",
    "Type d'essai et tension": "نوع الاختبار والشدّ",
    "Type d'essai": "نوع الاختبار",
    "Préalable": "تمهيدي",
    "Contrôle": "مراقبة",
    "Essai préalable": "اختبار تمهيدي",
    "Essai de contrôle": "اختبار مراقبة",
    "Nombre de cycles de charge–décharge": "عدد دورات التحميل–التفريغ",
    "Nombre de clous à tester *": "عدد المسامير المراد اختبارها *",
    "Nombre de clous (saisie)": "عدد المسامير (إدخال)",
    "Matériel de mise en tension et de mesure": "عتاد الشدّ والقياس",
    "Modèle de vérin creux *": "طراز المكبس المجوّف *",
    "— Choisir le vérin —": "— اختر المكبس —",
    "Mesure de l'effort": "قياس القوة",
    "Capteur de force": "حسّاس قوة",
    "Manomètre": "مقياس ضغط",
    "Comparateurs": "المقارنات",
    "1 comparateur": "مقارن واحد",
    "2 comparateurs": "مقارنان",
    "N° de série": "الرقم التسلسلي",
    "N° de série comparateur 1": "الرقم التسلسلي للمقارن 1",
    "N° de série comparateur 2": "الرقم التسلسلي للمقارن 2",
    "Étalonnage valide jusqu'au": "المعايرة صالحة حتى",
    "Étalonnage comparateurs valide jusqu'au": "معايرة المقارنات صالحة حتى",
    "Efforts et pressions à appliquer": "القوى والضغوط الواجب تطبيقها",
    "Programme de paliers et seuils": "برنامج المراحل والعتبات",
    "Palier de serrage Pa": "مرحلة الشدّ الأولي Pa",
    "Paliers de chargement": "مراحل التحميل",
    "Paliers de déchargement": "مراحل التفريغ",
    "Durée palier (min)": "مدة المرحلة (دقيقة)",
    "Durée palier final (min)": "مدة المرحلة النهائية (دقيقة)",
    "Détection de stabilisation": "كشف الاستقرار",
    "Seuils d'interprétation et d'arrêt": "عتبات التفسير والإيقاف",
    "Identification du clou": "تعريف المسمار",
    "Repère *": "العلامة *",
    "Zone / PK": "المنطقة / ن.ك",
    "Caractéristiques du clou": "خصائص المسمار",
    "Photos": "الصور",
    "Avant essai": "قبل الاختبار",
    "Dispositif en place": "الجهاز في مكانه",
    "Après essai": "بعد الاختبار",
    "Libre": "حرّ",
    "Déroulé par paliers": "التسلسل بالمراحل",
    "Anomalies": "الحالات الشاذة",
    "Signaler une anomalie": "الإبلاغ عن حالة شاذة",
    "Aucune anomalie signalée.": "لا توجد حالات شاذة مُبلّغ عنها.",
    "Aucune photo.": "لا توجد صور.",
    "Résultats et classement": "النتائج والتصنيف",
    "Effort cible": "القوة المستهدفة",
    "Pression à appliquer": "الضغط الواجب تطبيقه",
    "Temps de palier": "زمن المرحلة",
    "Lectures": "القراءات",
    "Palier suivant →": "المرحلة التالية →",
    "Oui, palier suivant": "نعم، المرحلة التالية",
    "Non, poursuivre le palier": "لا، مواصلة المرحلة",
    "Clôturer ce palier maintenant": "إغلاق هذه المرحلة الآن",
    "Type": "النوع",
    "Gravité": "الخطورة",
    "Mineure": "طفيفة",
    "Majeure": "كبيرة",
    "Critique": "حرجة",
    "Description": "الوصف",
    "Récapitulatif de campagne": "ملخّص الحملة",
    "Essai et matériel": "الاختبار والعتاد",
    "Programme et seuils": "البرنامج والعتبات",
    "Résultats par clou": "النتائج حسب المسمار",
    "Arrachement": "النزع",

    // ---- Consignes de sécurité — ARRACHEMENT ----
    "Périmètre de sécurité balisé — personne dans le prolongement de l'axe de la barre": "محيط أمان محدَّد — لا أحد في امتداد محور القضيب",
    "Écran ou protection en place dans l'axe du vérin": "حاجز أو حماية في محور المكبس",
    "Harnais antichute relié à un point d'ancrage indépendant du dispositif d'essai et du clou testé": "حزام مانع للسقوط مربوط بنقطة تثبيت مستقلة عن جهاز الاختبار وعن المسمار المختبَر",
    "Assise du dispositif de réaction stable — appuis hors de la zone d'influence du clou": "قاعدة جهاز رد الفعل مستقرّة — المساند خارج نطاق تأثير المسمار",
    "Protection du parement interposée sous les appuis": "حماية الواجهة موضوعة تحت المساند",
    "Flexibles, raccords et manomètre vérifiés — limiteur de pression en service": "الخراطيم والوصلات ومقياس الضغط مُتحقَّق منها — محدّد الضغط في الخدمة",
    "EPI portés (casque, gants, lunettes, chaussures de sécurité)": "معدّات الوقاية الفردية مرتداة (خوذة، قفازات، نظارات، أحذية أمان)",
    "Conditions météo compatibles avec la mesure et la sécurité": "الأحوال الجوية ملائمة للقياس وللسلامة",
    "Communication établie entre l'opérateur du vérin et le lecteur des comparateurs": "التواصل قائم بين مُشغّل المكبس وقارئ المقارنات",
  };

  const PROTECT = /^(EV1|EV2|K|Ø600|NF P94|XP P94|NF EN|CPS|GPS|PIN|OPM|MPa|bar|daN|kN|mm|α|Tmax|Pa|RCH|QC\/P60|QC\/COMP|QC\/ARR|γd|γh|w|%)/;

  function lang() { return _lang; }
  function T(s) {
    if (_lang !== 'ar' || s == null) return s;
    const k = String(s).trim();
    return AR[k] || s;
  }

  // emoji/pictogrammes/flèches de tête (pas les chiffres ni les lettres)
  const LEAD = new RegExp('^([\\u2190-\\u21FF\\u2300-\\u27BF\\u2B00-\\u2BFF\\u{1F000}-\\u{1FAFF}\\uFE0F\\u200D]+\\s*)([\\s\\S]+)$', 'u');

  function _translateNode(n) {
    const raw = n.nodeValue;
    const t = raw.trim();
    if (!t) return;
    let tr = AR[t];
    if (tr) { if (n.__fr == null) n.__fr = raw; n.nodeValue = raw.replace(t, tr); return; }
    // repli : ignorer un préfixe emoji/flèche puis retraduire le reste
    const m = t.match(LEAD);
    if (m && AR[m[2].trim()]) {
      if (n.__fr == null) n.__fr = raw;
      n.nodeValue = raw.replace(t, m[1] + AR[m[2].trim()]);
    }
  }

  function translate(root) {
    root = root || document.body;
    if (_lang !== 'ar') return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(_translateNode);
    // placeholders + title
    (root.querySelectorAll ? root.querySelectorAll('[placeholder]') : []).forEach(el => {
      const t = (el.getAttribute('placeholder') || '').trim();
      if (AR[t]) { if (!el.dataset.frPh) el.dataset.frPh = el.getAttribute('placeholder'); el.setAttribute('placeholder', AR[t]); }
    });
  }

  function _restoreAll() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) if (n.__fr != null) { n.nodeValue = n.__fr; n.__fr = null; }
    document.querySelectorAll('[data-fr-ph]').forEach(el => { el.setAttribute('placeholder', el.dataset.frPh); delete el.dataset.frPh; });
  }

  function setLang(l) {
    _lang = (l === 'ar') ? 'ar' : 'fr';
    localStorage.setItem(KEY, _lang);
    document.documentElement.lang = _lang;
    document.documentElement.dir = (_lang === 'ar') ? 'rtl' : 'ltr';
    document.body.classList.toggle('lang-ar', _lang === 'ar');
    _restoreAll();
    if (_lang === 'ar') translate(document.body);
    _updateToggles();
  }

  function _updateToggles() {
    document.querySelectorAll('[data-lang-btn]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.langBtn === _lang);
    });
  }

  function _bindToggles() {
    document.querySelectorAll('[data-lang-btn]').forEach(b => {
      if (b.__bound) return; b.__bound = true;
      b.addEventListener('click', () => setLang(b.dataset.langBtn));
    });
    _updateToggles();
  }

  function _observe() {
    if (_obs) return;
    _obs = new MutationObserver(muts => {
      if (_lang !== 'ar') return;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) translate(node);
          else if (node.nodeType === 3) _translateNode(node);
        }
      }
    });
    _obs.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    _bindToggles();
    _observe();
    setLang(_lang);
    // alertes : traduire les messages fixes (lignes connues)
    const _alert = window.alert.bind(window);
    window.alert = (m) => _alert(String(m).split('\n').map(line => T(line)).join('\n'));
  }

  return { init, setLang, lang, T, translate, _bindToggles };
})();

document.addEventListener('DOMContentLoaded', () => I18N.init());
