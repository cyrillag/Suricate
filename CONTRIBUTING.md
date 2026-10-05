# Contribuer à Suricate

Bienvenue ! Ce guide explique comment proposer une évolution, la tester sur ta propre preview, puis la
soumettre au mainteneur (Cyril), qui la relit, la merge et la déploie en prod.

## En bref

```
master ──► feature/ma-modif ──► preview/contrib (test) ──► Pull Request ──► review + merge + prod
           (ta branche)          ta preview :31625            (toi)          (le mainteneur)
```

- Tu travailles sur une branche `feature/…`, jamais sur `master`.
- Pour tester, tu pousses ta branche sur `preview/contrib` : **ta preview se met à jour toute seule en une
  minute** sur http://gw.lab.core.ovh.net:31625.
- Quand c'est bon, tu ouvres une Pull Request. Le mainteneur relit, merge et met en prod.

Tu n'as besoin d'**aucun accès** à la machine qui héberge Suricate.

## Mise en place (une fois)

1. Accepte l'invitation GitHub au repo `cyrillag/Suricate` (privé).
2. Clone et active le garde-fou :
   ```sh
   git clone https://github.com/cyrillag/Suricate.git && cd Suricate
   git config core.hooksPath .githooks      # empêche un push direct sur master
   ```
3. Ouvre Claude Code dans le dossier : il charge automatiquement `CLAUDE.md` (les règles du projet), les
   skills `suricate-preview` / `suricate-ship` et les agents de QA du repo.
4. (Conseillé) installe la CLI GitHub `gh` et fais `gh auth login` : Claude Code pourra ouvrir les PR pour toi.

## Proposer une évolution

1. **Pars de master à jour** : `git checkout master && git pull && git checkout -b feature/ma-modif`
2. **Décris ton besoin à Claude Code.** Il lit d'abord `FUNCTIONAL_RULES.md` (les règles métier, avec leur
   raison d'être) — si ta demande en contredit une, il te le dira : c'est voulu, on en discute.
3. **Teste** : demande « déploie sur la preview » (skill `suricate-preview`). Il pousse ta branche sur
   `preview/contrib`, attend le déploiement et te donne l'URL. Le badge de la preview affiche
   `Preview · contrib · <commit>`. Si le build échoue, il récupère le log et corrige.
   Ta preview a **sa propre base de données** (copie de la prod faite à l'installation) : tu peux y générer
   ou supprimer des rapports sans risque.
4. **Soumets** : « ouvre la PR » (skill `suricate-ship`). Il vérifie les conventions, pousse ta branche et
   ouvre la Pull Request avec le modèle du repo.
5. **Review** : le mainteneur relit (avec l'agent `suricate-reviewer`), te demande des ajustements si besoin,
   puis merge et déploie en prod.

## Les conventions du projet

Dans la même PR que le code :
- **`FUNCTIONAL_RULES.md`** mis à jour si une règle métier change ou apparaît — avec le *pourquoi*.
- **`whats-new/entries.json`** : une entrée si les PM verront la différence (elle alimente la page Nouveautés
  et le digest Webex). Pas d'entrée pour une correction invisible.
- **Textes d'interface en FR et EN** (`i18n.js`).
- **Jamais de message d'erreur brut** à l'écran, **jamais de contenu Confluence/Jira inséré en HTML sans
  filtrage**.

Le détail est dans `CLAUDE.md` ; Claude Code les applique de lui-même.

## Bon à savoir

- **Une seule preview contributeur** : pousser une autre branche sur `preview/contrib` remplace la précédente.
- Un commit qui échoue au build n'est pas retenté : pousse un correctif.
- État de ta preview à tout moment : http://gw.lab.core.ovh.net:31625/version (commit déployé, état,
  et fin du log en cas d'échec).
- La preview utilise les vrais accès Jira / Confluence / BigPicture de l'app (en lecture). Elle ne peut pas
  envoyer le digest Webex.
- Tu ne peux pas déployer en prod, ni pousser sur `master` : c'est volontaire.
- Une question, un blocage : demande au mainteneur.
