# Ops — environnements sur la sdev

Tout tourne sur une seule machine (la sdev du mainteneur), en Docker Compose :

| Environnement | Port | Dossier hôte | Code déployé | Qui déploie |
|---|---|---|---|---|
| **Prod** | 31621 | `~/project-reports-app` | `master` | le mainteneur, à la main |
| **Preview de chacun** | voir `ops/previews.json` | `~/suricate-<slug>` | la branche `preview/<slug>` | **automatique** (`ops/autodeploy.sh`, cron chaque minute) |

`ops/previews.json` est la liste des previews : aujourd'hui **Cyril (31622)** et **Aurélien (31625)**.
URL : `http://gw.lab.core.ovh.net:<port>`. La gateway redirige aussi 31626-31629 (31623 et 31624 sont pris).

## Comment marche une preview

Personne n'a besoin d'accéder à la machine. On pousse sa branche sur `preview/<slug>`
(`git push --force origin HEAD:preview/<slug>`, ou le skill Claude Code `suricate-preview`) ; dans la
minute, `ops/autodeploy.sh` :

1. voit que `origin/preview/<slug>` a bougé ;
2. reconstruit l'image depuis ce commit et redémarre le conteneur ;
3. attend que `/version` affiche ce commit ;
4. publie le résultat : statut GitHub `suricate/preview-<slug>` sur le commit (visible dans la PR), et
   `http://gw.lab.core.ovh.net:<port>/version` (état + 40 dernières lignes du build en cas d'échec) ;
5. en cas d'échec, **remet en ligne la dernière version qui marchait** (la preview reste accessible, avec
   le log de l'échec).

Le badge de la preview affiche `Preview · <Prénom> · màj <jj/mm hh:mm>` : l'heure du dernier déploiement
réussi. Un commit en échec n'est pas retenté en boucle : il faut pousser un correctif.

### Isolation

- `~/suricate-<slug>/compose.yml` (rendu depuis `ops/preview/compose.template.yml`) et
  `~/suricate-<slug>/preview.env` sont **hors** du checkout : une branche change le code et le
  `Dockerfile`, pas les ports, les montages ni les secrets.
- Chaque preview a **sa propre base** (volume `suricate-<slug>_data`).
- Pas de token du bot digest Webex dans `preview.env` : une preview ne peut pas envoyer de digest.
- ⚠ Les tokens Jira / Confluence / BigPicture de `preview.env` sont ceux de l'app : le code testé
  s'exécute avec. Même niveau de confiance que l'accès en écriture au repo — d'où la recommandation d'un
  compte technique dédié plutôt que des PAT personnels.

## Ajouter une personne

1. Ajouter une ligne dans `ops/previews.json` (slug, prénom, port libre), via une PR mergée sur master.
2. Sur l'hôte :
   ```sh
   ~/suricate-cyril/src/ops/new-preview.sh <slug> \
     --tokens-from ~/project-reports-app/.env \
     --data-from project-reports-app_app-data      # copie de la base de prod (optionnel)
   ```
   Le script crée le dossier, le `compose.yml`, le `preview.env` (secret de session propre + tokens, jamais
   `DIGEST_*`), copie la base si demandé, installe l'agent et sa ligne de cron.
3. La preview se déploie toute seule au premier push sur `preview/<slug>`.
4. Inviter la personne sur GitHub (repo privé `cyrillag/Suricate`) et lui envoyer le guide d'onboarding :
   `http://gw.lab.core.ovh.net:31621/contribuer` (dans l'app, accessible à tout utilisateur connecté ; le
   tableau des previews s'y met à jour tout seul depuis `ops/previews.json`).

Attention au disque (≈1,5 Go libres) : chaque preview ajoute une image (couches en grande partie partagées)
et une base. Après une modification de `ops/autodeploy.sh` mergée sur master, relancer
`new-preview.sh <slug>` (il réinstalle l'agent) ou recopier le fichier dans `~/bin/suricate-autodeploy`.

## Retirer une personne

```sh
docker compose -p suricate-<slug> -f ~/suricate-<slug>/compose.yml down -v   # -v supprime sa base
crontab -l | grep -v "suricate-autodeploy <slug> " | crontab -
rm -rf ~/suricate-<slug>
```
puis retirer sa ligne de `ops/previews.json` et son accès GitHub.
