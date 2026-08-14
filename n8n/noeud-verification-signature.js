// Vérifie que la requête vient bien de Cloudinary.
//
// Ce webhook est une URL publique qui déclenche un commit sur le dépôt : sans
// cette vérification, n'importe qui connaissant l'adresse pourrait publier une
// image sur le site. Cloudinary signe chaque notification, on recalcule la
// signature et on refuse tout ce qui ne correspond pas.
//
// Formule Cloudinary : SHA1(corps_brut + timestamp + api_secret)
//
// SHA-1 est implémenté ici en JavaScript pur, à dessein. Le bac à sable des
// nœuds Code n'expose ni le module `crypto` de Node (il faudrait autoriser
// NODE_FUNCTION_ALLOW_BUILTIN) ni l'API Web Crypto globale. Cette version ne
// dépend d'aucune configuration de l'instance.

function sha1Hex(octets) {
  const n = octets.length;
  // Bourrage : un bit à 1, des zéros, puis la longueur en bits sur 64 bits.
  const totalBlocs = ((n + 8) >> 6) + 1;
  const mots = new Int32Array(totalBlocs * 16);
  for (let i = 0; i < n; i++) mots[i >> 2] |= octets[i] << (24 - (i % 4) * 8);
  mots[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
  mots[totalBlocs * 16 - 1] = n * 8;
  mots[totalBlocs * 16 - 2] = Math.floor((n * 8) / 4294967296);

  let h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);
  const rot = (v, s) => (v << s) | (v >>> (32 - s));

  for (let bloc = 0; bloc < totalBlocs; bloc++) {
    for (let i = 0; i < 16; i++) w[i] = mots[bloc * 16 + i];
    for (let i = 16; i < 80; i++)
      w[i] = rot(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rot(a, 5) + f + e + k + w[i]) | 0;
      e = d; d = c; c = rot(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

const secret = $env.CLOUDINARY_API_SECRET;
if (!secret) {
  throw new Error(
    "Variable d'environnement CLOUDINARY_API_SECRET absente côté n8n. " +
      'Relancer n8n avec CLOUDINARY_API_SECRET=… et ' +
      'N8N_BLOCK_ENV_ACCESS_IN_NODE=false.'
  );
}

const entree = $('Webhook Cloudinary').first();
const headers = entree.json.headers || {};
const signatureRecue = headers['x-cld-signature'];
const timestamp = headers['x-cld-timestamp'];

if (!signatureRecue || !timestamp) {
  throw new Error('Requête non signée : en-têtes Cloudinary manquants.');
}

// Le corps doit être repris tel quel, octet pour octet : ré-encoder l'objet
// JSON analysé changerait l'ordre des clés ou les espaces, et la signature ne
// correspondrait plus. L'option « Raw Body » du nœud Webhook place ce corps
// d'origine dans les données binaires ; `json.body` n'en est que la version
// analysée, inutilisable pour la vérification.
let corpsBrut;
if (entree.binary && entree.binary.data && entree.binary.data.data) {
  corpsBrut = Buffer.from(entree.binary.data.data, 'base64').toString('utf8');
} else if (typeof entree.json.body === 'string') {
  corpsBrut = entree.json.body;
} else {
  throw new Error(
    'Corps brut introuvable : activer « Raw Body » sur le nœud Webhook.'
  );
}

const attendue = sha1Hex(Buffer.from(corpsBrut + timestamp + secret, 'utf8'));

// Comparaison à durée constante : une comparaison classique s'arrête au premier
// caractère faux, ce qui laisse deviner la signature essai par essai.
const recue = String(signatureRecue);
let ecart = attendue.length ^ recue.length;
for (let i = 0; i < attendue.length; i++) {
  ecart |= attendue.charCodeAt(i) ^ recue.charCodeAt(i);
}
if (ecart !== 0) {
  throw new Error('Signature Cloudinary invalide : requête rejetée.');
}

// Rejette les notifications trop anciennes (rejeu d'une requête interceptée).
const ageSecondes = Math.floor(Date.now() / 1000) - Number(timestamp);
if (ageSecondes > 3600) {
  throw new Error(`Notification trop ancienne (${ageSecondes} s) : rejetée.`);
}

return [{ json: JSON.parse(corpsBrut) }];
