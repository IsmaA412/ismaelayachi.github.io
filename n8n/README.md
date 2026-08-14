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
CLOUDINARY_API_SECRET=votre_api_secret n8n start
```

Derrière un tunnel, cette commande s'accompagne de `WEBHOOK_URL` — voir
l'étape 4, qui donne la commande de démarrage complète.

Pour ne pas retaper le secret à chaque fois, ajoutez-le à `~/.zshrc` :

```bash
echo 'export CLOUDINARY_API_SECRET=votre_api_secret' >> ~/.zshrc
```

En Docker, ajoutez la ligne au `environment:` du service n8n et redémarrez le
conteneur.

> La vérification de signature utilise l'API Web Crypto, native dans Node.
> Contrairement au module `crypto` de Node, elle ne demande aucune
> configuration supplémentaire de n8n.

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
- **Event** : `Upload`

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

## Ce que fait le workflow, nœud par nœud

| Nœud                               | Rôle                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| **Webhook Cloudinary**             | Reçoit la notification. `Raw Body` activé — indispensable, voir plus bas. |
| **Configuration**                  | Regroupe dépôt, branche et tag en un seul endroit modifiable.          |
| **Vérifier la signature Cloudinary** | Rejette toute requête non signée, falsifiée ou rejouée.              |
| **Photo destinée au portfolio ?**  | Ne laisse passer que les uploads d'images portant le tag requis.       |
| **Lire photos.json**               | Récupère le fichier et son `sha` (exigé par GitHub pour écrire).       |
| **Ajouter la photo**               | Ajoute l'entrée en tête de liste et réencode le fichier.               |
| **Nouvelle photo ?**               | Bloque les notifications en double envoyées par Cloudinary.            |
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

**L'exécution est rouge sur la vérification de signature** — `CLOUDINARY_API_SECRET`
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

## Retirer une photo du site

Supprimez son entrée dans `photos.json` et commitez. La photo reste sur
Cloudinary : le site et le stockage sont indépendants, ce qui permet d'archiver
sans publier.

## Changer l'ordre des photos

L'ordre du tableau `photos` est l'ordre d'affichage. Le workflow insère les
nouveautés en tête ; pour les mettre en fin de galerie, remplacez `unshift` par
`push` dans le nœud **Ajouter la photo**.
