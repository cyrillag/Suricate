const DICT = {
  nav: {
    brand:   { fr: 'OVHcloud project reports',    en: 'OVHcloud project reports' },
    projects:{ fr: 'Projets',                     en: 'Projects' },
    logout:  { fr: 'Déconnexion',                 en: 'Logout' }
  },
  login: {
    subtitle: { fr: 'Connecte-toi avec ton email OVHcloud', en: 'Sign in with your OVHcloud email' },
    email_label: { fr: 'Email OVHcloud',          en: 'OVHcloud email' },
    submit:   { fr: 'Se connecter',               en: 'Sign in' },
    err_email_required: { fr: 'Adresse email requise.', en: 'Email address required.' },
    err_not_found: { fr: 'Email non trouvé dans Jira OVHcloud.', en: 'Email not found in OVHcloud Jira.' },
    err_generic: { fr: 'Erreur de connexion Jira : ', en: 'Jira connection error: ' }
  },
  dashboard: {
    title:    { fr: 'Mes projets',                en: 'My projects' },
    subtitle: { fr: 'Rapports de statut hebdomadaires pour tes projets OVHcloud', en: 'Weekly status reports for your OVHcloud projects' },
    new_project: { fr: '+ Nouveau projet',        en: '+ New project' },
    empty_title: { fr: 'Aucun projet pour l’instant', en: 'No projects yet' },
    empty_text:  { fr: 'Crée ton premier projet pour commencer à générer des rapports hebdomadaires.', en: 'Create your first project to start generating weekly reports.' },
    empty_cta:   { fr: 'Créer un projet',         en: 'Create a project' },
    report_one:  { fr: 'rapport',                 en: 'report' },
    report_other:{ fr: 'rapports',                en: 'reports' },
    last:        { fr: 'Dernier :',               en: 'Last:' },
    eta:         { fr: 'ETA',                     en: 'ETA' },
    generate:    { fr: 'Générer {{week}}',        en: 'Generate {{week}}' },
    view_reports:{ fr: 'Voir les rapports',       en: 'View reports' },
    delete_title:{ fr: 'Supprimer le projet',     en: 'Delete project' },
    delete_confirm: { fr: 'Supprimer le projet ‘{{name}}’ et ses {{count}} rapport(s) ? Cette action est irréversible.', en: 'Delete project ‘{{name}}’ and all {{count}} of its report(s)? This cannot be undone.' }
  },
  newProject: {
    title: { fr: 'Nouveau projet',                en: 'New project' },
    back:  { fr: '← Projets',                     en: '← Projects' },
    step1: { fr: 'Donne un nom à ton projet',     en: 'Give your project a name' },
    step1_opt: { fr: '(tu pourras le renommer plus tard)', en: '(you’ll be able to rename it later on)' },
    step2: { fr: 'Renseigne l’epic maître (LVL2)', en: 'Fill in the master epic (LVL2)' },
    step2_opt:  { fr: '(modifiable plus tard aussi)', en: '(also editable later)' },
    step2_hint: { fr: 'C’est l’epic de plus haut niveau auquel ton projet se rattache dans Jira. Son champ «End date» est lu automatiquement pour fixer la date cible — tu n’as pas à la saisir toi-même.', en: 'This is the top-level epic your project rolls up to in Jira. Its "End date" field is read automatically to set the Target ETA — you don’t fill that in yourself.' },
    step3: { fr: 'Colle l’URL de la page Confluence de ton projet', en: 'Paste the URL of your project’s Confluence page' },
    step3_hint: { fr: 'Colle l’URL depuis la barre d’adresse de ton navigateur (tous les formats de lien fonctionnent, y compris un lien avec "pageId="). L’espace et le titre sont extraits automatiquement. Tout n’est pas dans Jira : les sections «Deliverables status», «Week summary» et «Risk matrix» de cette page sont analysées pour créer les workstreams et pré-remplir chaque rapport hebdomadaire.', en: 'Paste the page’s URL from your browser’s address bar (any link format works, including a plain "pageId=" link) — space and title are extracted automatically. Not everything lives in Jira: sections "Deliverables status", "Week summary" and "Risk matrix" on this page are parsed to seed workstreams and pre-fill each weekly report.' },
    step4: { fr: 'Clique sur «Créer» ci-dessous', en: 'Click "Create" below' },
    step4_hint: { fr: 'L’app va récupérer la date cible depuis Jira, puis importer tes workstreams depuis la page Confluence. Tu arriveras sur la page de ton projet quelques secondes plus tard — avec un message d’erreur clair plutôt qu’un projet vide si le format ne correspond pas.', en: 'The app will fetch the epic’s ETA from Jira, then import your workstreams from the Confluence page. You’ll land on your project page a few seconds later — with a clear error message instead of an empty project if something doesn’t match the expected format.' },
    callout: { fr: '⚠ Ça ne marche que si ta page suit une structure précise — ce n’est pas du texte libre.', en: '⚠ This only works if your page follows a specific structure — it is <strong>not</strong> free-form.' },
    callout_link: { fr: 'Partir du modèle →',      en: 'Start from the template page →' },
    cancel: { fr: 'Annuler',                      en: 'Cancel' },
    submit: { fr: 'Créer et importer les epics',  en: 'Create & import epics' },
    err_required: { fr: 'Le nom du projet et l’epic racine sont obligatoires.', en: 'Project name and root epic are required.' },
    err_confluence_url: { fr: 'Une URL de page Confluence valide est requise — colle-la depuis la barre d’adresse de ton navigateur en visitant la page (ex : https://confluence.ovhcloud.tools/display/SPACE/Titre, ou un lien avec pageId=).', en: 'A valid Confluence page URL is required — paste it from your browser’s address bar while viewing the page (e.g. https://confluence.ovhcloud.tools/display/SPACE/Page+Title, or a pageId= link).' },
    err_create_failed: { fr: 'La création du projet a échoué suite à une erreur interne. Réessaie, et contacte un administrateur si le problème persiste.', en: 'Project creation failed due to an internal error. Try again, and contact an administrator if this persists.' }
  },
  editProject: {
    title:  { fr: 'Modifier le projet',           en: 'Edit project' },
    name_label: { fr: 'Nom du projet',            en: 'Project name' },
    epic_label: { fr: 'Epic Jira racine (LVL2)',  en: 'Root Jira epic (LVL2)' },
    epic_hint:  { fr: 'La date cible est relue depuis son champ «End date» à la sauvegarde.', en: 'Target ETA is re-read from its End date field when you save.' },
    confluence_label: { fr: 'URL de la page Confluence', en: 'Confluence page URL' },
    callout: { fr: '⚠ Doit suivre la structure requise.', en: '⚠ Must follow the required structure.' },
    callout_link: { fr: 'Voir le modèle →',       en: 'See the template page →' },
    cancel: { fr: 'Annuler',                      en: 'Cancel' },
    submit: { fr: 'Enregistrer',                  en: 'Save changes' },
    note: { fr: '<strong>Note :</strong> la sauvegarde ne met à jour que le nom, l’epic et la référence Confluence du projet — elle ne resynchronise pas les workstreams. Si tu as changé l’epic ou la page, utilise «↻ Sync Jira» / «↻ Sync Confluence» sur la page du projet ensuite.', en: '<strong>Note:</strong> saving only updates the project’s name, epic and Confluence page reference — it does not re-sync workstreams. If you changed the epic or page, use "↻ Sync Jira" / "↻ Sync Confluence" on the project page afterwards.' },
    err_required: { fr: 'Le nom du projet et l’epic racine sont obligatoires.', en: 'Project name and root epic are required.' },
    err_confluence_url: { fr: 'Une URL de page Confluence valide est requise — colle-la depuis la barre d’adresse de ton navigateur en visitant la page (ex : https://confluence.ovhcloud.tools/display/SPACE/Titre, ou un lien avec pageId=).', en: 'A valid Confluence page URL is required — paste it from your browser’s address bar while viewing the page (e.g. https://confluence.ovhcloud.tools/display/SPACE/Page+Title, or a pageId= link).' },
    extra_epics_label: { fr: 'Epics additionnels pour le Planning', en: 'Extra epics for Planning' },
    extra_epics_optional: { fr: '(optionnel)', en: '(optional)' },
    extra_epics_hint: { fr: 'Clés Jira séparées par une virgule ou un espace, à toujours inclure dans la section Planning — utile pour des epics rattachés à un autre programme LVL2 et donc invisibles pour la détection automatique. N’affecte pas la matrice des deliverables.', en: 'Comma- or space-separated Jira keys to always include in the Planning section — useful for epics that belong to a different LVL2 program and so aren’t reachable by automatic detection. Does not affect the deliverable matrix.' }
  },
  detail: {
    edit:      { fr: '✎ Modifier',                en: '✎ Edit' },
    sync_jira: { fr: '↻ Sync Jira',               en: '↻ Sync Jira' },
    sync_confluence: { fr: '↻ Sync Confluence',   en: '↻ Sync Confluence' },
    generate_report: { fr: 'Générer le rapport',  en: 'Generate report' },
    week_input_title: { fr: 'AAAA-Wss',           en: 'YYYY-Www' },
    week_input_aria: { fr: 'Semaine à générer, format AAAA-Wss', en: 'Week to generate, format YYYY-Www' },
    auto_note: { fr: 'Les rapports sont générés automatiquement depuis {{source}} et les statuts d’epics Jira — il n’y a rien à saisir ici. Pour corriger un rapport, corrige-le à la source (page Confluence ou Jira) puis régénère-le.', en: 'Reports are generated automatically from {{source}} and Jira epic statuses — there is nothing to type in here. To correct a report, fix it at the source (Confluence page or Jira) then regenerate.' },
    auto_note_confluence: { fr: 'la page Confluence', en: 'the Confluence page' },
    auto_note_jira: { fr: 'Jira',                 en: 'Jira' },
    sync_failed: { fr: '⚠ La synchronisation {{source}} a échoué : {{message}} — réessaie avec les boutons ci-dessus.', en: '⚠ {{source}} sync failed: {{message}} — retry with the buttons above.' },
    source_jira: { fr: 'Jira',                    en: 'Jira' },
    source_confluence: { fr: 'Confluence',        en: 'Confluence' },
    past_reports: { fr: 'Rapports précédents',    en: 'Past reports' },
    no_reports: { fr: 'Aucun rapport pour l’instant. Génère {{week}} ci-dessus pour créer le premier.', en: 'No reports yet. Generate {{week}} above to create the first one.' },
    week_col: { fr: 'Semaine',                    en: 'Week' },
    view:     { fr: 'Voir',                       en: 'View' },
    regenerate: { fr: '↻ Régénérer',              en: '↻ Regenerate' },
    delete:   { fr: '🗑 Supprimer',               en: '🗑 Delete' },
    delete_confirm: { fr: 'Supprimer le rapport {{week}} ? Cette action est irréversible.', en: 'Delete the {{week}} report? This cannot be undone.' },
    syncing:  { fr: 'Synchronisation…',           en: 'Syncing…' },
    synced_epics: { fr: '✓ {{count}} epics synchronisés', en: '✓ {{count}} epics synced' },
    synced_workstreams: { fr: '✓ {{count}} workstreams synchronisés', en: '✓ {{count}} workstreams synced' },
    error:    { fr: '✗ Erreur',                   en: '✗ Error' },

    // Human-readable translations of every classified sync/integration failure (see errors.js
    // AppError codes) — a PM must never see a raw HTTP status or JSON API payload in the UI.
    err_confluence_not_found: { fr: 'La page Confluence est introuvable ou n’est plus accessible à cette adresse. Vérifie l’URL du projet (✎ Modifier) ou tes droits d’accès à la page.', en: 'The Confluence page could not be found at this address, or is no longer accessible. Check the project’s Confluence URL (✎ Edit) or your access rights to the page.' },
    err_confluence_forbidden: { fr: 'Accès refusé à la page Confluence : droits insuffisants ou token de service expiré. Contacte un administrateur si le problème persiste.', en: 'Access to the Confluence page was denied: insufficient rights or an expired service token. Contact an administrator if this persists.' },
    err_confluence_unavailable: { fr: 'Confluence est temporairement indisponible ou injoignable. Réessaie dans quelques instants.', en: 'Confluence is temporarily unavailable or unreachable. Try again in a moment.' },
    err_confluence_http_error: { fr: 'Confluence a renvoyé une erreur inattendue pendant la synchronisation. Réessaie, et contacte un administrateur si le problème persiste.', en: 'Confluence returned an unexpected error during sync. Try again, and contact an administrator if this persists.' },
    err_confluence_no_deliverables_table: { fr: 'La page Confluence a été trouvée, mais aucun tableau «Deliverables status» n’a pu être lu — vérifie que la page suit le format requis (voir le modèle lié sur le formulaire de création de projet).', en: 'The Confluence page was found, but no "Deliverables status" table could be read — check that the page follows the required format (see the template page linked on the New project form).' },
    err_confluence_empty_deliverables: { fr: 'Le tableau «Deliverables status» a été trouvé mais semble vide — ajoute au moins une ligne de workstream.', en: 'The "Deliverables status" table was found but appears empty — add at least one workstream row.' },
    err_confluence_no_week_summary_table: { fr: 'Aucun tableau «Week summary» n’a été trouvé sur la page Confluence — vérifie que la page suit le format requis (voir le modèle lié sur le formulaire de création de projet).', en: 'No "Week summary" table could be found on the Confluence page — check that it follows the required format (see the template page linked on the New project form).' },
    err_no_confluence_configured: { fr: 'Aucune page Confluence n’est configurée pour ce projet.', en: 'No Confluence page is configured for this project.' },
    err_invalid_week: { fr: 'Semaine invalide : « {{week}} ».', en: 'Invalid week: "{{week}}".' },
    err_future_week: { fr: 'Impossible de générer un rapport pour une semaine future.', en: 'Cannot generate a report for a future week.' },
    err_jira_not_found: { fr: 'L’epic ou le ticket Jira demandé est introuvable — vérifie la référence de l’epic racine (✎ Modifier).', en: 'The requested Jira epic or ticket could not be found — check the root epic reference (✎ Edit).' },
    err_jira_forbidden: { fr: 'Accès refusé à Jira : droits insuffisants ou token de service expiré. Contacte un administrateur si le problème persiste.', en: 'Access to Jira was denied: insufficient rights or an expired service token. Contact an administrator if this persists.' },
    err_jira_unavailable: { fr: 'Jira est temporairement indisponible ou injoignable. Réessaie dans quelques instants.', en: 'Jira is temporarily unavailable or unreachable. Try again in a moment.' },
    err_jira_http_error: { fr: 'Jira a renvoyé une erreur inattendue pendant la synchronisation. Réessaie, et contacte un administrateur si le problème persiste.', en: 'Jira returned an unexpected error during sync. Try again, and contact an administrator if this persists.' },
    err_generic: { fr: 'Une erreur inattendue est survenue pendant la synchronisation. Réessaie, et contacte un administrateur si le problème persiste.', en: 'An unexpected error occurred during sync. Try again, and contact an administrator if this persists.' }
  }
};

function translate(lang, key, vars) {
  const parts = key.split('.');
  let node = DICT;
  for (const p of parts) node = node?.[p];
  if (!node) return key;
  let text = node[lang] || node.fr || key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, v);
  return text;
}

function pluralize(lang, count, oneKey, otherKey) {
  return count === 1 ? translate(lang, oneKey) : translate(lang, otherKey);
}

module.exports = { translate, pluralize };
