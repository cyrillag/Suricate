const DICT = {
  nav: {
    brand:   { fr: 'Suricate',                    en: 'Suricate' },
    tagline: { fr: 'OVHcloud project reports',    en: 'OVHcloud project reports' },
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
    title:    { fr: 'Projets',                    en: 'Projects' },
    subtitle: { fr: 'Rapports de statut hebdomadaires des projets OVHcloud', en: 'Weekly status reports for OVHcloud projects' },
    new_project: { fr: '+ Nouveau projet',        en: '+ New project' },
    empty_title: { fr: 'Aucun projet pour l’instant', en: 'No projects yet' },
    empty_text:  { fr: 'Crée ton premier projet pour commencer à générer des rapports hebdomadaires.', en: 'Create your first project to start generating weekly reports.' },
    empty_cta:   { fr: 'Créer un projet',         en: 'Create a project' },
    owner:       { fr: 'Géré par {{name}}',       en: 'Managed by {{name}}' },
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
    milestones_label: { fr: 'Jalons du projet', en: 'Project milestones' },
    milestones_optional: { fr: '(optionnels)', en: '(optional)' },
    milestones_hint: { fr: 'Clé Jira ou URL de l’epic Alpha / Beta / GA, si le projet a ces étapes — remplace la Target ETA par une date par étape dans l’identité du projet.', en: 'Jira key or URL of the Alpha / Beta / GA epic, if the project has those phases — replaces the Target ETA with one date per phase in the project identity.' },
    bigpicture_label: { fr: 'Box BigPicture', en: 'BigPicture box' },
    bigpicture_optional: { fr: '(optionnel)', en: '(optional)' },
    bigpicture_hint: { fr: 'Identifiant de la box BigPicture du projet (ex : HYBR-95). Si renseigné, la section Planning du report utilise le scope configuré dans cette box au lieu de la liste plate des epics.', en: 'The project’s BigPicture box ID (e.g. HYBR-95). When set, the report’s Planning section uses that box’s configured scope instead of the flat epic list.' }
  },
  detail: {
    owner:     { fr: 'Responsable : {{name}}',    en: 'Owner: {{name}}' },
    cleanup_link: { fr: '🩺 Cleanup',             en: '🩺 Cleanup' },
    configure: { fr: 'Configurer',                en: 'Configure' },
    generate_report: { fr: 'Générer le rapport',  en: 'Generate report' },
    week_input_title: { fr: 'AAAA-Wss',           en: 'YYYY-Www' },
    week_input_aria: { fr: 'Semaine à générer, format AAAA-Wss', en: 'Week to generate, format YYYY-Www' },
    auto_note: { fr: 'Les rapports sont générés automatiquement depuis {{source}} et les statuts d’epics Jira — il n’y a rien à saisir ici. Pour corriger un rapport, corrige-le à la source (page Confluence ou Jira) puis régénère-le.', en: 'Reports are generated automatically from {{source}} and Jira epic statuses — there is nothing to type in here. To correct a report, fix it at the source (Confluence page or Jira) then regenerate.' },
    auto_note_confluence: { fr: 'la page Confluence', en: 'the Confluence page' },
    auto_note_jira: { fr: 'Jira',                 en: 'Jira' },
    source_jira: { fr: 'Jira',                    en: 'Jira' },
    source_confluence: { fr: 'Confluence',        en: 'Confluence' },
    source_bigpicture: { fr: 'BigPicture',        en: 'BigPicture' },
    past_reports: { fr: 'Rapports précédents',    en: 'Past reports' },
    no_reports: { fr: 'Aucun rapport pour l’instant. Génère {{week}} ci-dessus pour créer le premier.', en: 'No reports yet. Generate {{week}} above to create the first one.' },
    no_reports_viewer: { fr: 'Aucun rapport pour l’instant — seul le responsable du projet peut en générer.', en: 'No reports yet — only the project owner can generate one.' },
    week_col: { fr: 'Semaine',                    en: 'Week' },
    view:     { fr: 'Voir',                       en: 'View' },
    regenerate: { fr: '↻ Rafraîchir',             en: '↻ Refresh' },
    delete:   { fr: '🗑 Supprimer',               en: '🗑 Delete' },
    delete_confirm: { fr: 'Supprimer le rapport {{week}} ? Cette action est irréversible.', en: 'Delete the {{week}} report? This cannot be undone.' },
    no_report_row: { fr: 'Aucun rapport',         en: 'No report' },
    backfilled_tag: { fr: 'généré après coup',    en: 'generated after the fact' },

    // The "missing week" page (report-missing.ejs) — a past week that was never generated, shown
    // instead of the old silent auto-backfill-on-visit behaviour (see FUNCTIONAL_RULES.md).
    missing_title: { fr: 'Aucun rapport pour {{week}}', en: 'No report for {{week}}' },
    missing_explanation: { fr: 'Personne n’a généré de rapport pour cette semaine passée. Contrairement à la semaine en cours, une semaine passée n’est jamais générée automatiquement.', en: 'Nobody generated a report for this past week. Unlike the current week, a past week is never generated automatically.' },
    backfilled_notice: { fr: '⚠ Généré le {{date}}, après coup — reflète les données au moment de la génération, pas nécessairement l’état réel de la semaine {{week}}.', en: '⚠ Generated on {{date}}, after the fact — reflects data as of generation, not necessarily what was true during week {{week}}.' },

    // Human-readable translations of every classified sync/integration failure (see errors.js
    // AppError codes) — a PM must never see a raw HTTP status or JSON API payload in the UI.
    err_confluence_no_deliverables_table: { fr: 'La page Confluence a été trouvée, mais aucun tableau «Deliverables status» n’a pu être lu — vérifie que la page suit le format requis (voir le modèle lié sur le formulaire de création de projet).', en: 'The Confluence page was found, but no "Deliverables status" table could be read — check that the page follows the required format (see the template page linked on the New project form).' },
    err_confluence_empty_deliverables: { fr: 'Le tableau «Deliverables status» a été trouvé mais semble vide — ajoute au moins une ligne de workstream.', en: 'The "Deliverables status" table was found but appears empty — add at least one workstream row.' },
    err_confluence_no_week_summary_table: { fr: 'Aucun tableau «Week summary» n’a été trouvé sur la page Confluence — vérifie que la page suit le format requis (voir le modèle lié sur le formulaire de création de projet).', en: 'No "Week summary" table could be found on the Confluence page — check that it follows the required format (see the template page linked on the New project form).' },
    err_invalid_week: { fr: 'Semaine invalide : « {{week}} ».', en: 'Invalid week: "{{week}}".' },
    err_future_week: { fr: 'Impossible de générer un rapport pour une semaine future.', en: 'Cannot generate a report for a future week.' },
    err_past_week_locked: { fr: 'Ce rapport appartient à une semaine passée et reste figé : impossible de le régénérer. Seule la semaine en cours peut être régénérée.', en: 'This report belongs to a past week and stays frozen: it cannot be regenerated. Only the current week can be regenerated.' },
    // Service errors — one message per cause we can actually tell apart (see errors.js and each
    // service module). Each one says what happened, where, and what to do next: renewing a token
    // is not the same fix as fixing a page or just waiting, and retrying only helps for the latter.
    err_jira_token_invalid: { fr: 'Jira ne reconnaît plus le token de service de Suricate : il a probablement expiré ou été révoqué. Il faut générer un nouveau Personal Access Token Jira, le mettre dans JIRA_SERVICE_TOKEN (fichier .env du serveur) et redémarrer l’application. Réessayer ne changera rien d’ici là.', en: 'Jira no longer recognizes Suricate’s service token: it has most likely expired or been revoked. Generate a new Jira Personal Access Token, put it in JIRA_SERVICE_TOKEN (the server’s .env file) and restart the app. Retrying won’t help until then.' },
    err_jira_captcha: { fr: 'Jira a verrouillé le compte de service de Suricate après trop d’échecs de connexion (CAPTCHA). Connecte-toi une fois à Jira dans un navigateur avec ce compte pour le débloquer, puis réessaie.', en: 'Jira locked Suricate’s service account after too many failed logins (CAPTCHA). Log in to Jira once in a browser with that account to unlock it, then retry.' },
    err_jira_forbidden: { fr: 'Le compte de service de Suricate est bien connecté à Jira, mais n’a pas le droit de voir certains tickets de ce projet. Donne-lui l’accès en lecture aux projets Jira concernés (ou demande-le à leurs administrateurs).', en: 'Suricate’s service account is logged in to Jira but isn’t allowed to see some of this project’s tickets. Give it read access to the Jira projects involved (or ask their administrators).' },
    err_jira_not_found: { fr: 'Jira n’a pas trouvé l’élément demandé. Vérifie l’epic racine du projet (⚙ Configurer).', en: 'Jira couldn’t find the requested item. Check the project’s root epic (⚙ Configure).' },
    err_jira_issue_not_found: { fr: 'Le ticket Jira {{key}} est introuvable : il a été supprimé, déplacé (sa clé a changé), ou le compte de service n’a pas le droit de le voir. Vérifie la clé dans la configuration du projet (⚙).', en: 'Jira ticket {{key}} can’t be found: it was deleted, moved (its key changed), or the service account isn’t allowed to see it. Check the key in the project’s configuration (⚙).' },
    err_jira_bad_query: { fr: 'Jira a refusé la requête de recherche : « {{detail}} ». Si le projet utilise une box BigPicture, c’est la requête de périmètre de la box qui est en cause : corrige-la dans BigPicture.', en: 'Jira rejected the search query: "{{detail}}". If the project uses a BigPicture box, the box’s scope query is the culprit: fix it in BigPicture.' },
    err_jira_rate_limited: { fr: 'Jira limite temporairement le nombre de requêtes de Suricate. Attends une minute, puis réessaie.', en: 'Jira is temporarily rate-limiting Suricate. Wait a minute, then retry.' },
    err_jira_timeout: { fr: 'Jira n’a pas répondu à temps (plus de 15 secondes) : il est probablement surchargé. Réessaie dans quelques minutes.', en: 'Jira didn’t answer in time (over 15 seconds): it’s probably overloaded. Retry in a few minutes.' },
    err_jira_unreachable: { fr: 'Impossible de joindre Jira depuis le serveur Suricate (réseau ou DNS). Si Jira fonctionne dans ton navigateur, le problème vient du réseau du serveur.', en: 'Jira can’t be reached from the Suricate server (network or DNS). If Jira works in your browser, the problem is the server’s network.' },
    err_jira_unavailable: { fr: 'Jira a renvoyé une erreur interne : l’incident est côté Jira. Réessaie dans quelques minutes.', en: 'Jira returned an internal error: the problem is on Jira’s side. Retry in a few minutes.' },
    err_jira_http_error: { fr: 'Jira a renvoyé une erreur inattendue. Réessaie ; si ça persiste, le détail technique est dans les logs du serveur.', en: 'Jira returned an unexpected error. Retry; if it persists, the technical detail is in the server logs.' },
    err_confluence_token_invalid: { fr: 'Confluence ne reconnaît plus le token de service de Suricate : il a probablement expiré ou été révoqué. Il faut générer un nouveau Personal Access Token Confluence, le mettre dans CONFLUENCE_SERVICE_TOKEN (fichier .env du serveur) et redémarrer l’application. Réessayer ne changera rien d’ici là.', en: 'Confluence no longer recognizes Suricate’s service token: it has most likely expired or been revoked. Generate a new Confluence Personal Access Token, put it in CONFLUENCE_SERVICE_TOKEN (the server’s .env file) and restart the app. Retrying won’t help until then.' },
    err_confluence_space_forbidden: { fr: 'Le compte de service de Suricate est bien connecté à Confluence, mais n’a pas accès à l’espace « {{space}} ». Donne-lui les droits de lecture sur cet espace (ou demande-le à ses administrateurs).', en: 'Suricate’s service account is logged in to Confluence but has no access to space "{{space}}". Give it read permission on that space (or ask its administrators).' },
    err_confluence_page_not_found: { fr: 'La page Confluence « {{title}} » est introuvable dans l’espace « {{space}} » : elle a peut-être été renommée, déplacée ou supprimée. Mets à jour l’URL de la page dans la configuration du projet (⚙).', en: 'Confluence page "{{title}}" can’t be found in space "{{space}}": it may have been renamed, moved or deleted. Update the page URL in the project’s configuration (⚙).' },
    err_confluence_forbidden: { fr: 'Confluence refuse au compte de service de Suricate l’accès à la page « {{title}} » (restriction de lecture sur la page). Retire la restriction, ou ajoute ce compte aux lecteurs autorisés.', en: 'Confluence denies Suricate’s service account access to page "{{title}}" (a read restriction on the page). Remove the restriction, or add that account to the allowed readers.' },
    err_confluence_rate_limited: { fr: 'Confluence limite temporairement le nombre de requêtes de Suricate. Attends une minute, puis réessaie.', en: 'Confluence is temporarily rate-limiting Suricate. Wait a minute, then retry.' },
    err_confluence_timeout: { fr: 'Confluence n’a pas répondu à temps (plus de 15 secondes) : il est probablement surchargé. Réessaie dans quelques minutes.', en: 'Confluence didn’t answer in time (over 15 seconds): it’s probably overloaded. Retry in a few minutes.' },
    err_confluence_unreachable: { fr: 'Impossible de joindre Confluence depuis le serveur Suricate (réseau ou DNS). Si Confluence fonctionne dans ton navigateur, le problème vient du réseau du serveur.', en: 'Confluence can’t be reached from the Suricate server (network or DNS). If Confluence works in your browser, the problem is the server’s network.' },
    err_confluence_unavailable: { fr: 'Confluence a renvoyé une erreur interne : l’incident est côté Confluence. Réessaie dans quelques minutes.', en: 'Confluence returned an internal error: the problem is on Confluence’s side. Retry in a few minutes.' },
    err_confluence_http_error: { fr: 'Confluence a renvoyé une erreur inattendue. Réessaie ; si ça persiste, le détail technique est dans les logs du serveur.', en: 'Confluence returned an unexpected error. Retry; if it persists, the technical detail is in the server logs.' },
    err_bigpicture_token_missing: { fr: 'Le projet utilise la box BigPicture {{box}}, mais aucun token BigPicture n’est configuré sur le serveur (BIGPICTURE_API_TOKEN dans le fichier .env). La section Planning de ce rapport n’a pas pu être construite depuis BigPicture.', en: 'The project uses BigPicture box {{box}}, but no BigPicture token is configured on the server (BIGPICTURE_API_TOKEN in the .env file). This report’s Planning section could not be built from BigPicture.' },
    err_bigpicture_token_invalid: { fr: 'BigPicture refuse le token de Suricate (BIGPICTURE_API_TOKEN) : il a probablement expiré ou été révoqué. Génères-en un nouveau dans BigPicture, mets-le dans le fichier .env du serveur et redémarre l’application. La section Planning de ce rapport n’a pas pu être construite depuis BigPicture.', en: 'BigPicture rejects Suricate’s token (BIGPICTURE_API_TOKEN): it has most likely expired or been revoked. Generate a new one in BigPicture, put it in the server’s .env file and restart the app. This report’s Planning section could not be built from BigPicture.' },
    err_bigpicture_box_not_found: { fr: 'La box BigPicture {{box}} est introuvable. Vérifie son identifiant dans la configuration du projet (⚙). La section Planning de ce rapport n’a pas pu être construite depuis BigPicture.', en: 'BigPicture box {{box}} can’t be found. Check its ID in the project’s configuration (⚙). This report’s Planning section could not be built from BigPicture.' },
    err_bigpicture_unavailable: { fr: 'BigPicture a renvoyé une erreur interne pour la box {{box}}. Si ça persiste, c’est souvent le signe d’un token BIGPICTURE_API_TOKEN invalide plutôt que d’un incident. La section Planning de ce rapport n’a pas pu être construite depuis BigPicture.', en: 'BigPicture returned an internal error for box {{box}}. If it persists, that’s often a sign of an invalid BIGPICTURE_API_TOKEN rather than an outage. This report’s Planning section could not be built from BigPicture.' },
    err_bigpicture_rate_limited: { fr: 'BigPicture limite temporairement le nombre de requêtes de Suricate. Attends une minute, puis réessaie. La section Planning de ce rapport n’a pas pu être construite depuis BigPicture.', en: 'BigPicture is temporarily rate-limiting Suricate. Wait a minute, then retry. This report’s Planning section could not be built from BigPicture.' },
    err_bigpicture_timeout: { fr: 'BigPicture n’a pas répondu à temps (plus de 15 secondes). Réessaie dans quelques minutes. La section Planning de ce rapport n’a pas pu être construite depuis BigPicture.', en: 'BigPicture didn’t answer in time (over 15 seconds). Retry in a few minutes. This report’s Planning section could not be built from BigPicture.' },
    err_bigpicture_unreachable: { fr: 'Impossible de joindre BigPicture depuis le serveur Suricate (réseau ou DNS). La section Planning de ce rapport n’a pas pu être construite depuis BigPicture.', en: 'BigPicture can’t be reached from the Suricate server (network or DNS). This report’s Planning section could not be built from BigPicture.' },
    err_bigpicture_http_error: { fr: 'BigPicture a renvoyé une erreur inattendue pour la box {{box}}. Réessaie ; si ça persiste, le détail technique est dans les logs du serveur. La section Planning de ce rapport n’a pas pu être construite depuis BigPicture.', en: 'BigPicture returned an unexpected error for box {{box}}. Retry; if it persists, the technical detail is in the server logs. This report’s Planning section could not be built from BigPicture.' },
    err_generic: { fr: 'Une erreur inattendue est survenue pendant la synchronisation. Réessaie, et contacte un administrateur si le problème persiste.', en: 'An unexpected error occurred during sync. Try again, and contact an administrator if this persists.' },
    err_pdf_export: { fr: 'La génération du PDF a échoué. Réessaie, et contacte un administrateur si le problème persiste.', en: 'PDF generation failed. Try again, and contact an administrator if this persists.' }
  },

  // Cleanup: tracking-quality check over the same epics_cache data behind the Planning/Gantt
  // section — sibling naming/severity model to the "JIRA Cleanup" Webex bot (jira-hygiene-report).
  cleanup: {
    title:    { fr: 'Cleanup',                    en: 'Cleanup' },
    subtitle: { fr: 'Anomalies de suivi sur les epics de ce projet — mêmes données que la section Planning.', en: 'Tracking issues across this project’s epics — same data as the Planning section.' },
    epics_checked: { fr: '{{count}} epics vérifiées', en: '{{count}} epics checked' },
    last_synced: { fr: 'Dernière synchro Jira : {{when}}', en: 'Last Jira sync: {{when}}' },
    never_synced: { fr: 'jamais',                 en: 'never' },
    refresh_hint: { fr: 'Utilise «{{action}}» sur la page du projet pour rafraîchir ces données.', en: 'Use “{{action}}” on the project page to refresh this data.' },
    no_issues: { fr: 'Aucune anomalie détectée. 🎉', en: 'No issues found. 🎉' },

    high_priority: { fr: 'Priorité haute',        en: 'High priority' },
    upcoming: { fr: 'Échéances à venir',          en: 'Upcoming deadlines' },
    upcoming_hint: { fr: 'Pas une anomalie de suivi — juste un rappel.', en: 'Not a tracking issue — just a heads-up.' },
    remaining: { fr: 'Reste à traiter, par équipe', en: 'Remaining, by team' },

    rule_no_start:    { fr: 'sans start date',    en: 'no start date' },
    rule_no_end:      { fr: 'sans end date',      en: 'no end date' },

    detail_overdue:  { fr: 'End date dépassée depuis {{days}} j ({{date}}).', en: 'End date passed {{days}}d ago ({{date}}).' },
    detail_due_soon: { fr: 'Échéance dans {{days}} j ({{date}}).', en: 'Due in {{days}}d ({{date}}).' },
    detail_not_started: { fr: 'Start date dépassée depuis {{days}} j ({{date}}), toujours pas démarrée.', en: 'Start date passed {{days}}d ago ({{date}}), not started yet.' },
    detail_date_inconsistent: { fr: 'Start date ({{start}}) postérieure à la end date ({{end}}).', en: 'Start date ({{start}}) is after the end date ({{end}}).' },

    epic_count: { fr: '{{count}} epic(s)',        en: '{{count}} epic(s)' },
    contact_reporter_fallback: { fr: '{{name}} (reporter, pas d’assignee)', en: '{{name}} (reporter, no assignee)' },
    contact_none: { fr: 'non identifié',          en: 'unidentified' },
    view_in_jira: { fr: 'Voir dans Jira →',       en: 'View in Jira →' }
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
