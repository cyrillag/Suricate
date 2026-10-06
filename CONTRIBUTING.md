# Contribuer à Suricate — référence

> Pour démarrer, lis d'abord le **guide d'onboarding**, dans Suricate même :
> http://gw.lab.core.ovh.net:31621/contribuer (connexion requise). Ce fichier en est la version texte, dans le repo.

## Le circuit

```
master ──► feature/ma-modif ──► preview/<moi> ──► Pull Request ──► review + merge + prod
           ma branche           ma preview         moi              le mainteneur
```

- On travaille sur une branche `feature/…` ou `fix/…`, jamais sur `master`.
- Chacun a **sa preview** (`ops/previews.json`). Pousser sa branche sur `preview/<moi>` la met à jour toute
  seule, en une minute environ. Le badge affiche `Preview · <Prénom> · màj <heure>` : si l'heure suit ton
  dernier push, c'est ta version.
- Quand c'est bon, Pull Request. Le mainteneur relit, merge et met en prod. Personne d'autre ne touche à la prod.

Aucun accès à la machine qui héberge Suricate n'est nécessaire.

## Mise en place (une fois)

```sh
git clone https://github.com/cyrillag/Suricate.git && cd Suricate
git config core.hooksPath .githooks       # garde-fou : refuse un push direct sur master
git config suricate.preview <mon-slug>    # mon nom dans ops/previews.json, ex. aurelien
```

Puis ouvrir Claude Code dans ce dossier : il charge `CLAUDE.md` (les règles du projet), les skills
`suricate-preview` et `suricate-ship`, et les agents de QA.

Facultatif : installer la CLI GitHub `gh` (https://cli.github.com) puis `gh auth login` une fois,
pour que Claude Code ouvre les Pull Requests lui-même. Sans `gh`, il donne un lien et on ouvre la PR
dans le navigateur.

## Avec Claude Code

| Tu dis | Il fait |
|---|---|
| « Je voudrais que… » | crée une branche, lit `FUNCTIONAL_RULES.md`, propose et code — et te signale si ta demande contredit une règle existante |
| « Mets ça sur ma preview » | skill `suricate-preview` : pousse sur `preview/<toi>`, attend le déploiement, te donne l'URL ; si le build échoue, lit le log et corrige |
| « Ouvre la PR » | skill `suricate-ship` : vérifie les conventions, pousse la branche, ouvre la Pull Request |

## Les conventions

Dans la même PR que le code :
- `FUNCTIONAL_RULES.md` mis à jour si une règle métier change ou apparaît, avec le *pourquoi* ;
- une entrée dans `whats-new/entries.json` si les PM verront la différence (page Nouveautés + digest Webex) ;
- les textes d'interface en FR et EN (`i18n.js`) ;
- jamais de message d'erreur brut à l'écran, jamais de contenu Confluence/Jira inséré en HTML sans filtrage.

Détails dans `CLAUDE.md` — Claude Code les applique de lui-même.

## Bon à savoir

- État de ta preview à tout moment : `http://gw.lab.core.ovh.net:<ton port>/version`.
- Si un déploiement échoue, ta preview revient automatiquement à la version précédente ; le log de l'échec
  est sur `/version`. Pousse un correctif, le même commit n'est pas retenté.
- Ta preview a sa propre base : tu peux y générer ou supprimer des rapports sans risque pour la prod.
- Elle lit Jira / Confluence / BigPicture avec les vrais accès de l'app, et ne peut pas envoyer le digest Webex.
- Tu ne peux pas pousser sur `master` ni déployer en prod : c'est voulu.
- Côté machine (ajouter une personne, diagnostiquer un déploiement) : `ops/README.md`, réservé au mainteneur.
