# Ops — environnements sur la sdev

Tout tourne sur une seule machine (la sdev du mainteneur), en Docker Compose :

| Environnement | Port | Dossier hôte | Code déployé | Qui déploie |
|---|---|---|---|---|
| Prod | 31621 | `~/project-reports-app` | `master` | le mainteneur, à la main |
| Preview mainteneur | 31622 | `~/project-reports-app-preview` | la branche en cours du mainteneur | le mainteneur, à la main |
| Preview contributeur | 31625 | `~/suricate-contrib` | la branche `preview/contrib` | **automatique** (`ops/autodeploy.sh`, cron chaque minute) |

URL publiques : `http://gw.lab.core.ovh.net:<port>`.

## Preview contributeur

Le contributeur n'a **aucun accès** à la machine. Il pousse sa branche sur `preview/contrib`
(`git push --force origin HEAD:preview/contrib`, ou le skill Claude Code `suricate-preview`) ; dans la
minute, `ops/autodeploy.sh` :

1. voit que `origin/preview/contrib` a bougé ;
2. reconstruit l'image depuis ce commit et redémarre le conteneur ;
3. attend que `/version` affiche ce commit ;
4. publie le résultat : statut GitHub `suricate/preview-contrib` sur le commit (visible dans la PR) et
   `http://gw.lab.core.ovh.net:31625/version` (état + 40 dernières lignes du build en cas d'échec).

Un commit qui échoue n'est pas retenté en boucle : il faut pousser un correctif.

### Isolation

- `~/suricate-contrib/compose.yml` (copie de `ops/contrib/compose.yml`) et `~/suricate-contrib/contrib.env`
  sont **hors** du checkout : la branche du contributeur change le code et le `Dockerfile`, pas les
  ports, les montages ni les secrets.
- Base de données propre au contributeur (volume `suricate-contrib_contrib-data`), initialisée une fois
  depuis une copie de la prod.
- Pas de token du bot digest Webex dans `contrib.env` : une preview ne peut pas envoyer de digest.
- ⚠ Les tokens Jira / Confluence / BigPicture de `contrib.env` sont ceux de l'app : le code du
  contributeur s'exécute avec. Même niveau de confiance que l'accès en écriture au repo — d'où la
  recommandation d'un compte technique dédié plutôt que des PAT personnels.

### Installation (déjà faite — pour mémoire)

```sh
mkdir -p ~/suricate-contrib/status && cd ~/suricate-contrib
git clone https://github.com/cyrillag/Suricate.git src
cp src/ops/contrib/compose.yml compose.yml
# contrib.env : SESSION_SECRET propre + tokens Jira/Confluence/BigPicture (pas de DIGEST_*)
install -m 755 src/ops/autodeploy.sh ~/bin/suricate-autodeploy
( crontab -l; echo '* * * * * $HOME/bin/suricate-autodeploy contrib 31625 >/dev/null 2>&1' ) | crontab -
```

Après une modification de `ops/autodeploy.sh` mergée sur master : réinstaller la copie de `~/bin`.

### Ajouter un 2ᵉ contributeur

Même recette avec un autre slot (`bob`), un autre port libre redirigé par la gateway (31626-31629
le sont), un `compose.yml` adapté (port, `PREVIEW_NAME`, volume) et une 2ᵉ ligne de cron.
Attention au disque (≈1,5 Go libres) : chaque stack ajoute une image.
