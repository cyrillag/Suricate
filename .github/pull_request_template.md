## Quoi et pourquoi
<!-- Le besoin côté PM, en 2-3 phrases. -->

## Testé sur la preview
- [ ] Déployé sur ma preview (badge « màj » à l'heure de mon dernier push, `/version` en `success`)
- [ ] Parcours testé à la main : <!-- quelles pages, quels projets -->

## Conventions
- [ ] Règle métier nouvelle ou modifiée → `FUNCTIONAL_RULES.md` mis à jour dans cette PR
- [ ] Changement visible pour les PM → entrée dans `whats-new/entries.json` (titre, short, body FR/EN)
- [ ] Nouveaux textes d'interface en FR **et** EN (`i18n.js`)
- [ ] Pas de nouveau message d'erreur brut : passer par `AppError` + un modèle `detail.msg_*`
- [ ] Contenu venant de Confluence/Jira inséré en HTML → échappé, ou filtré par `confluence-format.js`

## Captures (si visuel)
