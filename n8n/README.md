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
par variable d'environnement — jamais en dur dans le workflow :

```bash
CLOUDINARY_API_SECRET=votre_api_secret
NODE_FUNCTION_ALLOW_BUILTIN=crypto
```

La seconde ligne autorise les nœuds Code à utiliser le module de cryptographie
de Node ; sans elle, la vérification de signature échoue au démarrage.

En Docker, ajoutez ces deux lignes au `environment:` du service n8n et
redémarrez le conteneur.

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

## 4. Brancher Cloudinary

Console Cloudinary → **Settings → Webhook Notifications → Add notification** :

- **URL** : l'URL de production copiée ci-dessus
- **Event** : `Upload`

n8n doit être joignable depuis Internet. En local, exposez-le via un tunnel
(`n8n tunnel`, ngrok, Cloudflare Tunnel).

## 5. Réglages Cloudinary conseillés

Dans **Settings → Upload → Upload presets**, sur le preset utilisé :

- **Tags** : ajoutez `portfolio` pour que les photos partent automatiquement en
  ligne. Sans ce tag, le workflow ignore l'upload — c'est le garde-fou qui vous
  permet de stocker des images sur Cloudinary sans les publier.
- **Colors** : activez l'analyse des couleurs. La couleur dominante est alors
  transmise à `photos.json` et sert d'aplat pendant le chargement de la
  vignette. Facultatif : sans elle, la galerie utilise un gris neutre.

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
est absent ou incorrect, ou `NODE_FUNCTION_ALLOW_BUILTIN=crypto` n'est pas
défini.

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
