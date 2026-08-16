// Applique la notification Cloudinary à photos.json : ajout ou retrait.
//
// photos.json est la seule source de la galerie. Ce nœud le lit, le modifie en
// mémoire et renvoie le contenu à commiter ; index.html n'est jamais touché.

const config = $('Configuration').first().json;
const notification = $('Vérifier la signature Cloudinary').first().json;
const fichier = $('Lire photos.json').first().json;

// L'API GitHub renvoie le contenu encodé en base64.
const actuel = JSON.parse(
  Buffer.from(fichier.content, 'base64').toString('utf8')
);
if (!Array.isArray(actuel.photos)) {
  throw new Error("photos.json est illisible : « photos » n'est pas une liste.");
}

const ignorer = (raison) => [{ json: { ignore: true, raison } }];

// Prépare la sortie destinée au nœud de commit.
const aCommiter = (message, resume) => {
  const contenu = JSON.stringify(actuel, null, 2) + '\n';
  return [
    {
      json: {
        ignore: false,
        message,
        total: actuel.photos.length,
        sha: fichier.sha,
        contenuBase64: Buffer.from(contenu, 'utf8').toString('base64'),
        urlContenu: `https://api.github.com/repos/${config.proprietaire}/${config.depot}/contents/${config.chemin}`,
        branche: config.branche,
        ...resume,
      },
    },
  ];
};

// ---------------------------------------------------------------- SUPPRESSION
if (notification.notification_type === 'delete') {
  const ressources = Array.isArray(notification.resources)
    ? notification.resources
    : [];

  // Une notification de suppression ne porte pas de tags : impossible d'y
  // vérifier que la photo appartenait au portfolio. Sa présence dans
  // photos.json en tient lieu — ce qui n'y figure pas ne peut pas en sortir.
  // Une suppression groupée en vise plusieurs à la fois, d'où la liste.
  const idsSupprimes = new Set(
    ressources
      .filter((r) => r && (!r.resource_type || r.resource_type === 'image'))
      .map((r) => r.public_id)
      .filter((id) => typeof id === 'string' && id.length > 0)
  );

  const retirees = actuel.photos
    .filter((p) => idsSupprimes.has(p.id))
    .map((p) => p.id);

  if (retirees.length === 0) {
    return ignorer(
      'Aucune des photos supprimées ne figurait dans photos.json.'
    );
  }

  // Garde-fou : une suppression groupée malencontreuse dans la médiathèque
  // Cloudinary viderait la galerie sans confirmation. Au-delà de la limite,
  // l'exécution s'arrête en erreur et rien n'est commité.
  const limite = Number(config.maxSuppressions);
  if (Number.isFinite(limite) && limite > 0 && retirees.length > limite) {
    throw new Error(
      `${retirees.length} photos seraient retirées en une fois, au-delà de la ` +
        `limite de ${limite}. Rien n'a été commité. Relever « maxSuppressions » ` +
        'dans le nœud Configuration, ou modifier photos.json à la main.'
    );
  }

  actuel.photos = actuel.photos.filter((p) => !idsSupprimes.has(p.id));

  return aCommiter(
    retirees.length === 1
      ? `Retrait de la photo ${retirees[0]}`
      : `Retrait de ${retirees.length} photos`,
    { action: 'supprimee', photos: retirees }
  );
}

// --------------------------------------------------------------------- AJOUT
// Cloudinary place les métadonnées saisies dans la médiathèque ici. Le texte
// alternatif décrit la photo pour les lecteurs d'écran et les moteurs de
// recherche : à renseigner dans Cloudinary, champ « alt ».
const contexte = (notification.context && notification.context.custom) || {};

// Couleur dominante, utilisée comme aplat pendant le chargement de la vignette.
// Cloudinary la fournit sous la forme [["#7c6c55", 34.1], ...], triée par
// dominance, quand l'option « Retrieve predominant colors and histogram » est
// cochée sur le preset d'upload. Sinon la galerie retombe sur un gris neutre.
let couleur = null;
if (Array.isArray(notification.colors) && notification.colors.length > 0) {
  const premiere = notification.colors[0];
  const brut = Array.isArray(premiere) ? premiere[0] : premiere;
  // Cette valeur finit telle quelle dans une propriété CSS de la page. On
  // refuse tout ce qui n'est pas un code hexadécimal : mieux vaut le gris par
  // défaut qu'un aplat invisible ou une déclaration CSS cassée.
  if (typeof brut === 'string' && /^#[0-9a-f]{6}$/i.test(brut.trim())) {
    couleur = brut.trim().toLowerCase();
  }
}

const nouvelle = {
  id: notification.public_id,
  version: String(notification.version),
  format: notification.format,
  width: notification.width,
  height: notification.height,
  alt: contexte.alt || contexte.caption || '',
};
if (couleur) {
  nouvelle.color = couleur;
}

// Cloudinary peut renvoyer plusieurs fois la même notification. Sans ce filtre,
// la photo apparaîtrait en double dans la galerie.
if (actuel.photos.some((p) => p.id === nouvelle.id)) {
  return ignorer(`Photo « ${nouvelle.id} » déjà présente dans photos.json.`);
}

// Les nouveautés en tête de galerie.
actuel.photos.unshift(nouvelle);

return aCommiter(`Ajout de la photo ${nouvelle.id}`, {
  action: 'publiee',
  photo: nouvelle,
  photos: [nouvelle.id],
});
