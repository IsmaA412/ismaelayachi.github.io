# Publication automatique des photos via n8n

Quand une photo est envoyée sur Cloudinary avec le tag `portfolio`, elle apparaît
sur le site sans aucune intervention manuelle.

```
Upload Cloudinary ──▶ webhook n8n ──▶ vérif. signature ──▶ ajout dans photos.json
                                                                    │
                                              commit via API GitHub ─┘
                                                        │
                                          GitHub Pages redéploie le site
```

`photos.json` est la seule source de la galerie. Le fichier `index.html` n'est
jamais modifié : c'est ce qui rend l'automatisation fiable.

---

## 1. Créer le jeton GitHub

Sur https://github.com/settings/personal-access-tokens : **Fine-grained token**,
accès au seul dépôt `ismaelayachi.github.io`, permission **Contents: Read and
write**. Aucune autre permission n'est nécessaire.

Dans n8n, créez une credential **Header Auth** nommée `GitHub portfolio` :

| Champ | Valeur              |
| ----- | ------------------- |
| Name  | `Authorization`     |
| Value | `Bearer VOTRE_JETON` |

> Le jeton ne doit exister que dans n8n. Ne le collez jamais dans un fichier du
> dépôt : tout ce qui est commité est public.

## 2. Déclarer le secret Cloudinary à n8n

Le workflow vérifie que chaque notification vient réellement de Cloudinary. Il
lui faut pour cela votre *API Secret* Cloudinary (Settings → Access Keys), fourni
par variable d'environnement — jamais en dur dans le workflow, car un workflow
exporté part avec ses valeurs.

n8n lit ses variables d'environnement **au démarrage** : il faut donc le
relancer avec la variable définie.

```bash
CLOUDINARY_API_SECRET=votre_api_secret N8N_BLOCK_ENV_ACCESS_IN_NODE=false n8n start
```

**`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` est obligatoire.** Depuis n8n 2.x,
l'accès à `$env` depuis un nœud Code est bloqué par défaut ; sans ce réglage, la
vérification de signature échoue avec `access to env vars denied`. Le blocage
est décidé ici, dans le code de n8n :

```js
// n8n-workflow/dist/cjs/workflow-data-proxy-env-provider.js
const isEnvAccessBlocked = process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE !== 'false';
```

> Ce réglage vaut pour toute l'instance : n'importe quel nœud Code de n'importe
> quel workflow pourra lire toutes vos variables d'environnement. Sur une
> instance personnelle qui n'exécute que vos propres workflows, c'est sans
> conséquence. Sur une instance partagée, ça ne l'est pas.

Derrière un tunnel, cette commande s'accompagne de `WEBHOOK_URL` — voir
l'étape 4, qui donne la commande de démarrage complète.

Pour ne pas retaper le secret à chaque fois, ajoutez-le à `~/.zshrc` :

```bash
echo 'export CLOUDINARY_API_SECRET=votre_api_secret' >> ~/.zshrc
```

En Docker, ajoutez la ligne au `environment:` du service n8n et redémarrez le
conteneur.

> La vérification de signature embarque sa propre implémentation de SHA-1, en
> JavaScript pur. Le bac à sable des nœuds Code n'expose ni le module `crypto`
> de Node ni l'API Web Crypto globale : `NODE_FUNCTION_ALLOW_BUILTIN` est donc
> inutile ici.

## 3. Importer le workflow

Dans n8n : **Workflows → Import from File →**
`workflow-cloudinary-vers-github.json`.

Ouvrez le nœud **Configuration** et vérifiez les valeurs :

| Champ          | Valeur par défaut          |
| -------------- | -------------------------- |
| `proprietaire` | `IsmaA412`                 |
| `depot`        | `ismaelayachi.github.io`   |
| `branche`      | `main`                     |
| `chemin`       | `photos.json`              |
| `tagRequis`    | `portfolio`                |

Sur les deux nœuds HTTP (**Lire photos.json** et **Commit photos.json**),
sélectionnez la credential `GitHub portfolio` créée à l'étape 1.

Activez le workflow, puis copiez l'URL de production du nœud **Webhook
Cloudinary** (bouton *Production URL*).

Ce champ est en lecture seule : n8n le construit à partir de l'adresse qu'il
pense avoir. Derrière un tunnel, il affiche `http://localhost:5678/...`, que
Cloudinary ne peut pas joindre. La solution n'est pas de modifier le champ mais
de déclarer l'adresse publique à n8n au démarrage, via `WEBHOOK_URL` (voir
l'étape suivante).

## 4. Brancher Cloudinary

Console Cloudinary → **Settings → Webhook Notifications → Add notification** :

- **URL** : l'URL de production copiée ci-dessus
- **Events** : cochez **`Upload`** *et* **`Delete`**

`Upload` publie la photo, `Delete` la retire. Sans `Delete`, une photo
supprimée de Cloudinary continuerait d'occuper une case vide dans la galerie.

n8n doit être joignable depuis Internet : Cloudinary ne peut pas appeler
`localhost`. Sur une installation locale, exposez-le par un tunnel. L'option
`--tunnel` intégrée a été retirée dans n8n 2.x, utilisez Cloudflare.

**L'ordre compte** : le tunnel d'abord, car son adresse doit être connue de n8n
au moment où il démarre.

```bash
brew install cloudflared && cloudflared tunnel --url http://localhost:5678
```

La commande affiche une URL publique en `https://….trycloudflare.com`. Laissez
ce terminal ouvert, puis relancez n8n en lui donnant cette adresse :

```bash
WEBHOOK_URL=https://votre-tunnel.trycloudflare.com \
CLOUDINARY_API_SECRET=votre_api_secret \
N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
n8n start
```

Le nœud **Webhook Cloudinary** affiche alors directement la bonne *Production
URL*, de la forme :

```
https://votre-tunnel.trycloudflare.com/webhook/cloudinary-photo
```

C'est cette adresse à coller dans Cloudinary.

> Cette URL change à chaque redémarrage de `cloudflared`, et le tunnel meurt
> avec le terminal — il faut alors relancer n8n avec la nouvelle valeur et la
> remettre à jour dans Cloudinary. C'est parfait pour mettre au point,
> insuffisant pour du permanent : il faudra alors un tunnel Cloudflare nommé
> (gratuit, URL fixe, demande un domaine) ou héberger n8n en ligne.

## 5. Réglages Cloudinary conseillés

Dans **Settings → Upload → Upload presets**, sur le preset utilisé :

- **Tags** : ajoutez `portfolio` pour que les photos partent automatiquement en
  ligne. Sans ce tag, le workflow ignore l'upload — c'est le garde-fou qui vous
  permet de stocker des images sur Cloudinary sans les publier.
- **Retrieve predominant colors and histogram** : à cocher. C'est le libellé
  de l'interface pour le paramètre `colors` de l'API. La couleur dominante de
  chaque photo est alors transmise à `photos.json` et sert d'aplat pendant le
  chargement de la vignette. Facultatif : sans elle, la galerie utilise un gris
  neutre, tout fonctionne pareil.

Le **texte alternatif** se saisit dans la médiathèque Cloudinary, champ `alt`
des métadonnées contextuelles. Il décrit la photo pour les lecteurs d'écran et
les moteurs de recherche. S'il est vide, la photo s'affiche quand même, mais
sans description.

---

## Au quotidien : publier de nouvelles photos

### Démarrer la chaîne

n8n tourne sur votre Mac : s'il est éteint au moment de l'upload, **Cloudinary
envoie la notification dans le vide et la photo ne sera jamais publiée**. Après
chaque redémarrage du Mac ou fermeture du terminal, relancez la chaîne :

```bash
cd "/Users/ismaelayachi/Site Photo 08:2026/site/n8n" && ./demarrer.sh
```

Le script ouvre le tunnel, lance n8n avec les trois variables nécessaires, et
place l'URL du webhook dans le presse-papiers. Laissez ce terminal ouvert :
Ctrl+C arrête l'ensemble.

### Rendre l'URL permanente (fortement conseillé)

Par défaut le script utilise un tunnel `trycloudflare`, dont **l'adresse change
à chaque démarrage**. Il faut alors la recoller dans Cloudinary — et l'oublier
signifie perdre silencieusement chaque upload, sans message d'erreur, sans même
une exécution en échec dans n8n. C'est de loin la panne la plus fréquente.

ngrok offre un domaine statique gratuit et permanent, ce qui supprime
définitivement ce report. Mise en place, une seule fois :

1. Compte gratuit sur https://dashboard.ngrok.com/signup
2. `brew install ngrok`
3. Authtoken depuis le tableau de bord :
   `ngrok config add-authtoken VOTRE_TOKEN`
4. Copiez votre domaine statique offert depuis le tableau de bord, section
   *Domains*. Le suffixe varie selon les comptes (`.ngrok-free.dev` ou
   `.ngrok-free.app`) : reprenez-le exactement tel qu'affiché, ne recopiez pas
   l'exemple ci-dessous.

```bash
echo 'export NGROK_DOMAIN=COLLEZ-ICI-VOTRE-DOMAINE' >> ~/.zshrc && source ~/.zshrc
```

Vérifiez ensuite que la variable est bien chargée — un `~/.zshrc` comportant
une erreur de syntaxe s'interrompt en silence, et tout ce qui suit la ligne
fautive est ignoré :

```bash
zsh -lic 'echo $NGROK_DOMAIN'
```

Si la commande n'affiche rien, la variable n'est pas définie : le script
retombera sur cloudflared sans que rien ne le signale.

`demarrer.sh` bascule alors tout seul en mode permanent. Vous collez l'URL dans
Cloudinary une dernière fois, et plus jamais ensuite.

Les quotas gratuits — 20 000 requêtes et 1 Go par mois — sont sans commune
mesure avec quelques notifications par semaine.

> Sans ngrok, le script continue de fonctionner en repli `cloudflared` et vous
> avertit explicitement, à chaque démarrage, que l'adresse a changé.

Prérequis, à faire une seule fois :

```bash
echo 'export CLOUDINARY_API_SECRET=votre_secret' >> ~/.zshrc && source ~/.zshrc
```

### L'upload lui-même

1. Envoyez la photo sur Cloudinary avec le tag **`portfolio`**.
2. Renseignez le champ **`alt`** dans les métadonnées contextuelles, au moment
   de l'upload.
3. Attendez environ une minute.

C'est tout. Aucune commande git, aucun fichier à modifier, aucun HTML à
toucher. La photo apparaît **en tête de galerie**.

> **Le texte alternatif doit être saisi à l'upload.** La notification part au
> moment où la photo arrive : un `alt` ajouté plus tard dans la médiathèque ne
> déclenche rien et n'atteindra jamais le site. Dans ce cas, il faut modifier
> `photos.json` à la main.

### Si la photo n'apparaît pas

Ouvrez n8n, onglet **Executions**. La notification y est conservée : inutile de
réenvoyer la photo sur Cloudinary, il suffit de **relancer l'exécution** une
fois le problème corrigé.

| Symptôme | Cause | Correctif |
| --- | --- | --- |
| Aucune exécution listée | Workflow inactif, ou Cloudinary n'a pas joint n8n | Activer le workflow (interrupteur en haut à droite) ; vérifier tunnel et URL |
| Rouge sur *Vérifier la signature*, `access to env vars denied` | `N8N_BLOCK_ENV_ACCESS_IN_NODE` non défini | Relancer n8n avec `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` |
| Rouge sur *Vérifier la signature*, `crypto is not defined` | Ancienne version du nœud | Recoller le code de `noeud-verification-signature.js` |
| Rouge sur *Vérifier la signature*, autre message | `CLOUDINARY_API_SECRET` absent ou faux | Relancer n8n avec la bonne valeur |
| `statut: "ignoree"` | Tag `portfolio` manquant, ou photo déjà publiée | Ajouter le tag et relancer l'exécution |
| Erreur 409 sur le commit | Deux uploads simultanés | Relancer l'exécution, sans rien changer |

### Retirer une photo, ou changer l'ordre

Ces deux opérations restent manuelles, dans `photos.json` : supprimez l'entrée
correspondante, ou déplacez-la dans le tableau. L'ordre du tableau est l'ordre
d'affichage. Supprimer une entrée ne supprime pas la photo de Cloudinary.

### Pour ne plus avoir à y penser

Tant que n8n tourne sur votre Mac, publier suppose que la machine soit allumée
et les deux terminaux ouverts. Pour une automatisation qui fonctionne même
Mac éteint, il faut héberger n8n en ligne — n8n Cloud, ou une petite instance
chez un hébergeur. L'URL du webhook devient alors fixe, et les deux préalables
ci-dessus disparaissent.

---

## Ce que fait le workflow, nœud par nœud

| Nœud                               | Rôle                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| **Webhook Cloudinary**             | Reçoit la notification. `Raw Body` activé — indispensable, voir plus bas. |
| **Configuration**                  | Regroupe dépôt, branche et tag en un seul endroit modifiable.          |
| **Vérifier la signature Cloudinary** | Rejette toute requête non signée, falsifiée ou rejouée.              |
| **Notification pertinente ?**      | Laisse passer les uploads d'images portant le tag requis, et les suppressions. |
| **Lire photos.json**               | Récupère le fichier et son `sha` (exigé par GitHub pour écrire).       |
| **Modifier photos.json**           | Ajoute l'entrée en tête de liste, ou retire les photos supprimées.     |
| **Changement à commiter ?**        | Bloque les doublons et les suppressions sans effet.                    |
| **Commit photos.json**             | Écrit le fichier. GitHub Pages redéploie tout seul.                    |

### Pourquoi « Raw Body » est obligatoire

Cloudinary signe le corps de la requête **octet pour octet**. Si n8n analyse le
JSON puis que le workflow le ré-encode, l'ordre des clés et les espaces peuvent
changer : la signature recalculée ne correspond plus et toute notification
légitime est rejetée. L'option `Raw Body` du nœud Webhook conserve le corps
d'origine.

### Pourquoi le `sha`

L'API GitHub exige le `sha` du fichier tel qu'il était au moment de la lecture.
Si `photos.json` a changé entre la lecture et l'écriture, GitHub refuse le
commit plutôt que d'écraser la modification. Deux photos envoyées exactement en
même temps : la seconde échoue proprement au lieu d'effacer la première. Il
suffit alors de relancer l'exécution depuis n8n.

---

## Vérifier que ça marche

1. Envoyez une photo sur Cloudinary avec le tag `portfolio`.
2. n8n → onglet **Executions** : l'exécution doit être verte.
3. Le dépôt doit montrer un commit « Ajout de la photo … ».
4. Après le déploiement Pages (environ une minute), la photo est en tête de
   galerie.

**`access to env vars denied` sur la vérification de signature** — il manque
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` au démarrage de n8n.

**Autre erreur sur la vérification de signature** — `CLOUDINARY_API_SECRET`
est absent ou incorrect. Vérifiez surtout que n8n a bien été **relancé** après
avoir défini la variable : il ne la relit pas à chaud.

**Aucune exécution n'apparaît** — Cloudinary n'atteint pas n8n. Vérifiez que
`cloudflared` tourne toujours et que l'URL déclarée dans Cloudinary correspond
au tunnel en cours.

**L'exécution est verte mais la photo n'apparaît pas** — regardez la réponse du
webhook : `statut: "ignoree"` signifie que le tag `portfolio` manque sur la
photo, ou qu'elle est déjà dans `photos.json`.

**Erreur 409 sur le commit** — deux uploads simultanés. Relancez l'exécution.

---

## Supprimer une photo

Supprimez-la depuis la médiathèque Cloudinary : elle disparaît du site dans la
minute, sans autre manipulation.

L'appartenance au portfolio ne peut pas être vérifiée à la suppression — une
notification `delete` de Cloudinary ne porte aucun tag, contrairement à un
upload. Le workflow retire donc simplement les entrées dont l'identifiant
figure dans `photos.json` : ce qui n'y est pas ne peut pas en sortir.

### Le garde-fou

Le champ `maxSuppressions` du nœud **Configuration** (5 par défaut) limite le
nombre de photos qu'une seule notification peut retirer. Au-delà, l'exécution
s'arrête en erreur et **rien n'est commité** : une sélection multiple
malencontreuse dans la médiathèque ne peut pas vider la galerie d'un coup.

Pour un grand ménage volontaire, relevez la valeur, ou modifiez `photos.json`
directement. Et rien n'est jamais perdu : chaque état du fichier reste dans
l'historique git.

### Retirer du site sans supprimer de Cloudinary

Supprimez l'entrée correspondante dans `photos.json` et commitez. L'original
reste stocké sur Cloudinary, il disparaît seulement du portfolio.

## Changer l'ordre des photos

L'ordre du tableau `photos` est l'ordre d'affichage. Le workflow insère les
nouveautés en tête ; pour les mettre en fin de galerie, remplacez `unshift` par
`push` dans le nœud **Modifier photos.json**.
